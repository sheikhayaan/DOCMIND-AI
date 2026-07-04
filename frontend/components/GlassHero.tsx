'use client';
import { Suspense, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, Lightformer, Icosahedron } from '@react-three/drei';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// Pointer position in normalized device coords, shared so the crystal can tilt
// toward the cursor without re-rendering React on every move.
const pointer = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });
}

// The faceted glass crystal: refractive transmission material, slow auto-spin,
// scroll-driven rotation, and a gentle tilt toward the cursor. A pulsing
// emissive core inside is what the bloom pass catches to make it glow.
function Crystal() {
  const mesh = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const coreColor = useRef(new THREE.Color('#6366f1'));
  const altColor = useRef(new THREE.Color('#ec4899'));

  useFrame((state, delta) => {
    if (!mesh.current) return;
    const scrollFactor = typeof window !== 'undefined' ? window.scrollY * 0.0015 : 0;
    // Continuous spin + scroll contribution.
    mesh.current.rotation.y += delta * 0.25;
    mesh.current.rotation.x = scrollFactor + Math.sin(state.clock.elapsedTime * 0.3) * 0.1;
    // Ease toward the cursor for a subtle parallax tilt.
    mesh.current.rotation.z += (pointer.x * 0.25 - mesh.current.rotation.z) * 0.05;
    const targetScale = hovered ? 1.08 : 1;
    mesh.current.scale.x += (targetScale - mesh.current.scale.x) * 0.1;
    mesh.current.scale.y = mesh.current.scale.x;
    mesh.current.scale.z = mesh.current.scale.x;

    // Pulse the inner core: breathe its scale and shift its hue over time.
    if (core.current && coreMat.current) {
      const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 1.5) * 0.5; // 0..1
      const s = 0.32 + pulse * 0.12;
      core.current.scale.setScalar(s);
      coreMat.current.color.copy(coreColor.current).lerp(altColor.current, pulse);
    }
  });

  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.8}>
      <Icosahedron
        ref={mesh}
        args={[1.25, 0]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <MeshTransmissionMaterial
          transmission={1}
          thickness={1.4}
          roughness={0.05}
          ior={1.5}
          chromaticAberration={0.6}
          anisotropy={0.3}
          distortion={0.4}
          distortionScale={0.4}
          temporalDistortion={0.2}
          color="#dfe3ff"
          attenuationColor="#a855f7"
          attenuationDistance={1.2}
        />
        {/* Emissive inner core — overdriven color so Bloom blooms it. */}
        <mesh ref={core}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial ref={coreMat} color="#6366f1" toneMapped={false} />
        </mesh>
      </Icosahedron>
    </Float>
  );
}

// Studio lighting rig: colored light bars that reflect across the glass facets
// and give the brand-tinted highlights that make the object read as premium.
function Lighting() {
  return (
    <Environment resolution={256}>
      <group rotation={[0, 0, 1]}>
        <Lightformer intensity={2} position={[0, 5, -9]} scale={[10, 10, 1]} color="#6366f1" />
        <Lightformer intensity={3} position={[-5, 1, -1]} scale={[3, 6, 1]} color="#ec4899" />
        <Lightformer intensity={3} position={[5, -1, -1]} scale={[3, 6, 1]} color="#8b5cf6" />
        <Lightformer intensity={1.5} position={[0, -5, -2]} scale={[10, 6, 1]} color="#a5b4fc" />
      </group>
    </Environment>
  );
}

export default function GlassHero() {
  return (
    <div className="glass-hero-canvas" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 35 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.4} />
        <Suspense fallback={null}>
          <Crystal />
          <Lighting />
        </Suspense>
        <EffectComposer>
          <Bloom
            mipmapBlur
            intensity={1.2}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.3}
            radius={0.7}
          />
          <Vignette eskil={false} offset={0.2} darkness={0.6} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
