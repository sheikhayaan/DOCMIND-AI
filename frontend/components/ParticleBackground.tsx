'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Advanced two-system particle field with connecting lines, mouse repulsion,
// figure-8 camera drift and a breathing color pulse. Pure WebGL, no per-frame
// allocations, every GPU object disposed on unmount.
export default function ParticleBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // ---- System A: deep-field galaxy (3000, radius 150) ----
    const A_COUNT = 3000;
    const aPositions = new Float32Array(A_COUNT * 3);
    const aColors = new Float32Array(A_COUNT * 3);
    const palette = [new THREE.Color('#6366f1'), new THREE.Color('#8b5cf6'), new THREE.Color('#ec4899')];
    for (let i = 0; i < A_COUNT; i++) {
      const r = 60 + Math.random() * 90; // spread through a massive sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      aPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      aPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      aPositions[i * 3 + 2] = r * Math.cos(phi);
      const c = palette[Math.floor(Math.random() * palette.length)];
      aColors[i * 3] = c.r;
      aColors[i * 3 + 1] = c.g;
      aColors[i * 3 + 2] = c.b;
    }
    const aGeo = new THREE.BufferGeometry();
    aGeo.setAttribute('position', new THREE.BufferAttribute(aPositions, 3));
    aGeo.setAttribute('color', new THREE.BufferAttribute(aColors, 3));
    const aMat = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const systemA = new THREE.Points(aGeo, aMat);
    scene.add(systemA);

    // ---- System B: foreground interactive layer (800, radius 40) ----
    const B_COUNT = 800;
    const bPositions = new Float32Array(B_COUNT * 3); // live positions (rendered)
    const bHome = new Float32Array(B_COUNT * 3); // rest positions to return to
    for (let i = 0; i < B_COUNT; i++) {
      const r = Math.cbrt(Math.random()) * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      bPositions[i * 3] = x;
      bPositions[i * 3 + 1] = y;
      bPositions[i * 3 + 2] = z;
      bHome[i * 3] = x;
      bHome[i * 3 + 1] = y;
      bHome[i * 3 + 2] = z;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPositions, 3));
    const bColorBase = new THREE.Color('#6366f1');
    const bColorAlt = new THREE.Color('#8b5cf6');
    const bMat = new THREE.PointsMaterial({
      size: 0.2,
      color: bColorBase.clone(),
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const systemB = new THREE.Points(bGeo, bMat);
    scene.add(systemB);

    // ---- Connecting lines between nearby System-B particles (cap 200) ----
    const MAX_LINES = 200;
    const MAX_DIST = 8;
    const linePositions = new Float32Array(MAX_LINES * 2 * 3);
    const lineColors = new Float32Array(MAX_LINES * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    const linePosAttr = new THREE.BufferAttribute(linePositions, 3);
    const lineColAttr = new THREE.BufferAttribute(lineColors, 3);
    linePosAttr.setUsage(THREE.DynamicDrawUsage);
    lineColAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('position', linePosAttr);
    lineGeo.setAttribute('color', lineColAttr);
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lineSegments);
    const lineColor = new THREE.Color('#6366f1');

    // ---- Interaction state ----
    const mouseNdc = new THREE.Vector2(0, 0);
    const smoothMouse = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();
    const intersectPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectPoint = new THREE.Vector3();

    const handleMouseMove = (e: MouseEvent) => {
      mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const REPEL_RADIUS = 6;
    const REPEL_FORCE = 0.3;
    const RETURN_LERP = 0.02;

    let animId = 0;
    const start = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = performance.now() - start;

      // System A slow galaxy drift
      systemA.rotation.x += 0.00005;
      systemA.rotation.y += 0.00008;

      // Smooth mouse follow (lerp 0.08) and project onto z=0 plane
      smoothMouse.x += (mouseNdc.x - smoothMouse.x) * 0.08;
      smoothMouse.y += (mouseNdc.y - smoothMouse.y) * 0.08;
      raycaster.setFromCamera(smoothMouse, camera);
      raycaster.ray.intersectPlane(intersectPlane, intersectPoint);

      // Mouse repulsion + spring-back for System B
      const bAttr = bGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < B_COUNT; i++) {
        const ix = i * 3;
        let px = bPositions[ix];
        let py = bPositions[ix + 1];
        let pz = bPositions[ix + 2];

        if (intersectPoint) {
          const dx = px - intersectPoint.x;
          const dy = py - intersectPoint.y;
          const dz = pz - intersectPoint.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < REPEL_RADIUS && dist > 0.0001) {
            const push = (1 - dist / REPEL_RADIUS) * REPEL_FORCE;
            px += (dx / dist) * push;
            py += (dy / dist) * push;
            pz += (dz / dist) * push;
          }
        }
        // Ease back toward home
        px += (bHome[ix] - px) * RETURN_LERP;
        py += (bHome[ix + 1] - py) * RETURN_LERP;
        pz += (bHome[ix + 2] - pz) * RETURN_LERP;

        bPositions[ix] = px;
        bPositions[ix + 1] = py;
        bPositions[ix + 2] = pz;
      }
      bAttr.needsUpdate = true;

      // Rebuild connecting lines (cap at MAX_LINES)
      let lineCount = 0;
      for (let i = 0; i < B_COUNT && lineCount < MAX_LINES; i++) {
        const ax = bPositions[i * 3];
        const ay = bPositions[i * 3 + 1];
        const az = bPositions[i * 3 + 2];
        for (let j = i + 1; j < B_COUNT && lineCount < MAX_LINES; j++) {
          const bx = bPositions[j * 3];
          const by = bPositions[j * 3 + 1];
          const bz = bPositions[j * 3 + 2];
          const dx = ax - bx;
          const dy = ay - by;
          const dz = az - bz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < MAX_DIST * MAX_DIST) {
            const d = Math.sqrt(d2);
            const o = lineCount * 6;
            linePositions[o] = ax;
            linePositions[o + 1] = ay;
            linePositions[o + 2] = az;
            linePositions[o + 3] = bx;
            linePositions[o + 4] = by;
            linePositions[o + 5] = bz;
            const fade = (1 - d / MAX_DIST) * 0.15; // fades with distance
            for (let k = 0; k < 2; k++) {
              lineColors[o + k * 3] = lineColor.r * fade;
              lineColors[o + k * 3 + 1] = lineColor.g * fade;
              lineColors[o + k * 3 + 2] = lineColor.b * fade;
            }
            lineCount++;
          }
        }
      }
      lineGeo.setDrawRange(0, lineCount * 2);
      linePosAttr.needsUpdate = true;
      lineColAttr.needsUpdate = true;

      // Color pulse: 4s cycle — 2s lerp to alt, hold, back
      const phase = (time % 4000) / 4000;
      let t = 0;
      if (phase < 0.5) t = phase / 0.5; // 0 -> 1 over first 2s
      else t = 1 - (phase - 0.5) / 0.5; // 1 -> 0 over next 2s
      bMat.color.copy(bColorBase).lerp(bColorAlt, t * 0.6);

      // Camera figure-8 drift (depth breathing)
      if (!reduceMotion) {
        camera.position.x = Math.sin(time * 0.0003) * 3;
        camera.position.y = Math.cos(time * 0.0005) * 1.5;
        camera.position.z = 30 + Math.sin(time * 0.0002) * 5;
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      aGeo.dispose();
      aMat.dispose();
      bGeo.dispose();
      bMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    />
  );
}
