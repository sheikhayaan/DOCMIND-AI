"""Real LLM circuit breakers, half-open probes, and grounded offline failover."""

import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from apm.common import setting, utc_now
from apm.incidents import IncidentTracker, incident_tracker
from apm.schemas import ActionExecution, BreakerStatus, GatewayStatus


class LLMClient(Protocol):
    """Describes the small synchronous interface used by LangChain provider clients."""

    def invoke(self, messages: list[dict]) -> object:
        """Invokes one provider request with a client-level timeout."""
        ...


class GatewayUnavailable(RuntimeError):
    """Signals that generation must use the existing grounded offline path."""


@dataclass
class Circuit:
    """Stores one model's protected circuit state and probe ownership."""

    failures: int = 0
    retry_at: float = 0
    probing: bool = False
    last_success: float | None = None
    last_success_iso: str | None = None


class LLMGateway:
    """Serializes half-open probes and routes failed calls to another configured model."""

    def __init__(self, models: list[str] | None = None, tracker: IncidentTracker = incident_tracker, clock: Callable[[], float] = time.monotonic) -> None:
        """Creates process-local breakers without making a network call at import time."""
        configured = models or [os.getenv("GROQ_PRIMARY_MODEL", "llama-3.1-8b-instant"), *os.getenv("GROQ_FALLBACK_MODELS", "llama-3.3-70b-versatile").split(",")]
        self.models = list(dict.fromkeys(model.strip() for model in configured if model.strip()))[:5]
        self.states = {model: Circuit() for model in self.models}
        self.lock = threading.RLock()
        self.clock, self.tracker = clock, tracker
        self.backoff = setting("APM_CIRCUIT_BACKOFF_SECONDS", 30, 1, 600)
        self.threshold = int(setting("APM_CIRCUIT_FAILURE_THRESHOLD", 2, 1, 10))
        self.active_model = self.models[0]
        self.offline = False
        self.probe_model: Callable[[str], object] | None = None
        self.offline_available: Callable[[], bool] = lambda: False
        self.is_configured: Callable[[], bool] = lambda: bool(os.getenv("GROQ_API_KEY", "").strip())

    def configure(self, probe: Callable[[str], object], offline_available: Callable[[], bool]) -> None:
        """Registers real provider probes and a read-only check for grounded local documents."""
        self.probe_model, self.offline_available = probe, offline_available

    def preferred_model(self) -> str:
        """Selects an available route or fails fast into the caller's offline answer branch."""
        with self.lock:
            if self.offline:
                raise GatewayUnavailable("Generation is using grounded offline extracts during provider backoff")
            order = [self.active_model, *self.models]
            for model in dict.fromkeys(order):
                state = self.states[model]
                if not state.probing and (state.failures < self.threshold or self.clock() >= state.retry_at):
                    return model
        raise GatewayUnavailable("All generation circuits are backing off")

    def _acquire(self, model: str) -> bool:
        """Allows one half-open request after backoff while other callers take the fallback."""
        with self.lock:
            if model not in self.states:
                # Vision has a fixed, bounded model list supplied by query.py.
                if len(self.states) >= 8:
                    return False
                self.states[model] = Circuit()
            state = self.states[model]
            if state.probing or (state.failures >= self.threshold and self.clock() < state.retry_at):
                return False
            if state.failures >= self.threshold:
                state.probing = True
            return True

    def _succeeded(self, model: str) -> None:
        """Closes a circuit only after an actual successful provider response."""
        with self.lock:
            self.states[model] = Circuit(last_success=self.clock(), last_success_iso=utc_now())
            if model in self.models:
                self.active_model = model
            self.offline = False

    def _failed(self, model: str, error: Exception) -> None:
        """Records sanitized failure categories and applies bounded exponential backoff."""
        with self.lock:
            state = self.states[model]
            state.failures += 1
            state.probing = False
            state.retry_at = self.clock() + min(600, self.backoff * 2 ** min(4, state.failures - 1))
        status = getattr(error, "status_code", None)
        lowered = str(error).lower()
        if isinstance(error, TimeoutError) or "timeout" in lowered or "timed out" in lowered:
            category, severity, code = "LLM_TIMEOUT", "high", 504
        elif status == 429 or "429" in lowered or "rate_limit" in lowered:
            category, severity, code = "LLM_RATE_LIMIT", "medium", 429
        elif status in {401, 403} or "invalid_api_key" in lowered:
            category, severity, code = "LLM_AUTH_ERROR", "critical", 502
        else:
            category, severity, code = "LLM_UPSTREAM_FAILURE", "high", 502
        self.tracker.record(category, severity, "gateway/groq", f"Model {model} failed; circuit backoff applied. Provider response bodies were not retained.", code)

    def invoke(self, client: LLMClient, messages: list[dict], factory: Callable[[str], LLMClient], attempts: int = 2) -> object:
        """Tries an available model and then a different fallback, never an unbounded retry storm."""
        with self.lock:
            if self.offline:
                raise GatewayUnavailable("Grounded offline route is active")
        model = str(getattr(client, "model_name", None) or self.preferred_model())
        order = list(dict.fromkeys([model, *self.models]))[:max(1, min(attempts, 5))]
        last_error: Exception | None = None
        for selected in order:
            if not self._acquire(selected):
                continue
            try:
                active = client if selected == model else factory(selected)
                result = active.invoke(messages)
                self._succeeded(selected)
                return result
            except Exception as exc:
                last_error = exc
                self._failed(selected, exc)
        if last_error:
            raise last_error
        raise GatewayUnavailable("All generation circuits are backing off")

    def reset_eligible(self) -> ActionExecution:
        """Reopens only backoff-eligible circuits whose real half-open probe succeeds."""
        action = "CIRCUIT_BREAKER_RESET"
        if not self.is_configured() or self.probe_model is None:
            return ActionExecution(action=action, status="skipped", notes="Provider credentials or probe adapter are not configured.")
        with self.lock:
            degraded = [model for model, state in self.states.items() if state.failures]
            eligible = [model for model in degraded if self.clock() >= self.states[model].retry_at and not self.states[model].probing]
        if not degraded:
            return ActionExecution(action=action, status="skipped", notes="No circuit requires recovery.")
        if not eligible:
            return ActionExecution(action=action, status="deferred", notes="Backoff has not elapsed; manual actions cannot bypass it.")
        repaired: list[str] = []
        for model in eligible:
            with self.lock:
                if self.states[model].probing:
                    continue
                self.states[model].probing = True
            try:
                self.probe_model(model)
                self._succeeded(model)
                repaired.append(model)
            except Exception as exc:
                self._failed(model, exc)
        with self.lock:
            primary = self.states[self.models[0]]
            if not primary.failures and primary.last_success is not None:
                self.active_model, self.offline = self.models[0], False
        all_repaired = bool(repaired) and not any(state.failures for state in self.snapshot().breakers)
        return ActionExecution(
            action=action, status="success" if all_repaired else "failed", verified=all_repaired,
            notes=f"Verified recovery for {len(repaired)} circuit(s); other circuits remain degraded." if not all_repaired else "All degraded circuits passed a real provider probe.",
        )

    def cascade(self) -> ActionExecution:
        """Verifies a fallback model, otherwise enables only the grounded local answer route."""
        action = "CIRCUIT_FALLBACK_CASCADE"
        with self.lock:
            degraded = any(state.failures for state in self.states.values())
        if not degraded:
            return ActionExecution(action=action, status="skipped", notes="No provider degradation detected; primary routing is unchanged.")
        if self.is_configured() and self.probe_model:
            for model in self.models[1:]:
                with self.lock:
                    state = self.states[model]
                    if not state.failures and state.last_success is not None and self.clock() - state.last_success < 60:
                        self.active_model, self.offline = model, False
                        return ActionExecution(action=action, status="success", verified=True, notes=f"Routed to recently verified fallback {model}.")
                if not self._acquire(model):
                    continue
                try:
                    self.probe_model(model)
                    self._succeeded(model)
                    return ActionExecution(action=action, status="success", verified=True, notes=f"Fallback {model} passed a provider probe; primary remains degraded.")
                except Exception as exc:
                    self._failed(model, exc)
        if self.offline_available():
            with self.lock:
                self.offline = True
            return ActionExecution(action=action, status="success", verified=True, notes="Grounded local document extracts enabled. Availability is document-specific; generated/general answers remain degraded.")
        return ActionExecution(action=action, status="failed", notes="No verified fallback model or local document bank is available; manual intervention required.")

    def snapshot(self) -> GatewayStatus:
        """Returns circuit health without network calls or secret-bearing SDK objects."""
        now = self.clock()
        with self.lock:
            active = self.states[self.active_model]
            route = "offline" if self.offline else "primary" if self.active_model == self.models[0] else "fallback"
            return GatewayStatus(
                configured=self.is_configured(), route=route, activeModel=None if self.offline else self.active_model,
                verified=not self.offline and active.failures == 0 and active.last_success is not None and now - active.last_success < 300,
                breakers=[BreakerStatus(
                    model=model, state="half-open" if state.probing else "open" if state.failures >= self.threshold else "closed",
                    failures=state.failures, retryAfterSeconds=round(max(0, state.retry_at - now), 2), lastSuccessAt=state.last_success_iso,
                ) for model, state in self.states.items()],
            )


gateway = LLMGateway()
