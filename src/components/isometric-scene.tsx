"use client";

import { Canvas } from "@react-three/fiber";
import { IsometricFallback } from "./isometric-fallback";

function Platform({
  position,
  color,
  kind,
}: {
  position: [number, number, number];
  color: string;
  kind: "buyers" | "email" | "booking";
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[1.8, 0.16, 1.65]} />
        <meshStandardMaterial color="#e2e6f6" roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.6, 0.1, 1.45]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} />
      </mesh>
      {kind === "buyers" ? (
        [-0.45, 0, 0.45].map((x, index) => (
          <group key={x} position={[x, 0, index === 1 ? -0.15 : 0.12]}>
            <mesh position={[0, 0.55, 0]}>
              <boxGeometry args={[0.3, 0.6, 0.3]} />
              <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, 0.98, 0]}>
              <sphereGeometry args={[0.18, 16, 12]} />
              <meshStandardMaterial color="#c8cdfb" />
            </mesh>
          </group>
        ))
      ) : (
        <group position={[0, 0.75, 0]} rotation={[-0.12, 0, 0]}>
          <mesh>
            <boxGeometry args={[1.15, 0.9, 0.16]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
          <mesh position={[0, -0.05, 0.1]}>
            <boxGeometry args={[0.95, 0.58, 0.02]} />
            <meshStandardMaterial color="#f5f6ff" />
          </mesh>
          {kind === "booking" ? (
            [-0.28, 0, 0.28].map((x) => (
              <mesh key={x} position={[x, -0.08, 0.13]}>
                <boxGeometry args={[0.15, 0.15, 0.02]} />
                <meshStandardMaterial color={color} />
              </mesh>
            ))
          ) : (
            <group position={[0, 0, 0.13]}>
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  position={[side * 0.2, 0.04, 0]}
                  rotation={[0, 0, side * 0.5]}
                >
                  <boxGeometry args={[0.48, 0.035, 0.02]} />
                  <meshStandardMaterial color={color} />
                </mesh>
              ))}
            </group>
          )}
        </group>
      )}
    </group>
  );
}

export default function IsometricScene() {
  return (
    <Canvas
      orthographic
      camera={{ position: [7, 7, 9], zoom: 44 }}
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, alpha: true }}
      fallback={<IsometricFallback />}
    >
      <ambientLight intensity={1.8} />
      <directionalLight position={[4, 8, 3]} intensity={2.5} />
      <group position={[0, -0.35, 0]}>
        <mesh position={[0, -0.2, 0]}>
          <boxGeometry args={[5.5, 0.2, 4.4]} />
          <meshStandardMaterial color="#cbd1ea" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.05, 0]}>
          <boxGeometry args={[5.3, 0.12, 4.2]} />
          <meshStandardMaterial color="#eef0fc" roughness={0.8} />
        </mesh>
        <Platform position={[-1.35, 0, 0.85]} kind="buyers" color="#686dea" />
        <Platform position={[1.25, 0, 0.85]} kind="email" color="#4348d6" />
        <Platform position={[0, 0, -1.05]} kind="booking" color="#7378d8" />
        <mesh position={[0, 0.06, 0.75]}>
          <boxGeometry args={[0.9, 0.03, 0.06]} />
          <meshStandardMaterial color="#9299d8" />
        </mesh>
        <mesh position={[0, 0.06, -0.12]}>
          <boxGeometry args={[0.06, 0.03, 1.2]} />
          <meshStandardMaterial color="#9299d8" />
        </mesh>
      </group>
    </Canvas>
  );
}
