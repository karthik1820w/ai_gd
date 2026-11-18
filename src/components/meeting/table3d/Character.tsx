"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SeatInfo } from "../types";
import { FILL_STEPS, type Assets } from "./assets";
import { appearanceFor, damp, facingYaw, HEAD_HEIGHT, type SeatWorld } from "./seat3d";
import type { Theme } from "./theme";

const scratch = new THREE.Vector3();
const TAU = Math.PI * 2;

type Props = {
  seat: SeatInfo;
  target: SeatWorld;
  assets: Assets;
  theme: Theme;
  reduced: boolean;
  shadows: boolean;
  leaving?: boolean;
  labelEls: MutableRefObject<Map<string, HTMLElement>>;
};

/**
 * One seated cartoon character. Everything that changes many times a second (glide, mouth, arm, labels)
 * is driven from refs inside useFrame, so a new `seat` prop never re-draws the scene from scratch.
 * The look comes from the user id only and never from the name.
 */
export function Character({ seat, target, assets, theme, reduced, shadows, leaving = false, labelEls }: Props) {
  const look = useMemo(() => appearanceFor(seat.userId), [seat.userId]);
  const { size } = useThree();
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const live = useRef({ appear: 0, speak: 0, mouth: 0.05, arm: -1.2, x: target.x, z: target.z, placed: false });
  const wanted = useRef({ seat, target, leaving, reduced });
  wanted.current = { seat, target, leaving, reduced };

  // The beam and the "your turn" ring fade in and out per person, so they cannot share a material.
  const beamMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: theme.speak, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), [theme.speak]);
  const pulseMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: theme.gold, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), [theme.gold]);
  useEffect(() => () => { beamMaterial.dispose(); }, [beamMaterial]);
  useEffect(() => () => { pulseMaterial.dispose(); }, [pulseMaterial]);

  const ghost = !seat.connected;
  const pick = (hex: string) => (ghost ? assets.ghost(hex) : assets.solid(hex));
  const geo = assets.geo;
  const fillStep = Math.round(Math.max(0, Math.min(1, seat.fill)) * FILL_STEPS);

  // A label that has just been removed must not leave a stale element behind.
  useEffect(() => () => { labelEls.current.delete(seat.userId); }, [labelEls, seat.userId]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const { seat: s, target: t, leaving: gone, reduced: calm } = wanted.current;
    const state_ = live.current;
    const t0 = state.clock.elapsedTime;
    const phase = look.phase * TAU;

    // Glide to the seat, pop in when arriving, shrink away when leaving.
    if (!state_.placed) { state_.x = t.x; state_.z = t.z; state_.placed = true; }
    state_.x = calm ? t.x : damp(state_.x, t.x, 6, dt);
    state_.z = calm ? t.z : damp(state_.z, t.z, 6, dt);
    state_.appear = calm ? (gone ? 0 : 1) : damp(state_.appear, gone ? 0 : 1, 8, dt);
    state_.speak = calm ? (s.speaking ? 1 : 0) : damp(state_.speak, s.speaking ? 1 : 0, 10, dt);

    const g = group.current;
    if (g) {
      g.position.set(state_.x, 0, state_.z);
      g.rotation.y = facingYaw(state_.x, state_.z);
      const scale = Math.max(0.0001, state_.appear * (1 + 0.06 * state_.speak));
      g.scale.setScalar(scale);
      g.visible = state_.appear > 0.01;
    }

    // Speaking: a looped mouth movement (this is not lip-sync, the props carry no audio level).
    const openTarget = s.speaking ? (calm ? 0.45 : 0.3 + 0.7 * Math.abs(Math.sin(t0 * 11 + phase))) : 0.06;
    state_.mouth = calm ? openTarget : damp(state_.mouth, openTarget, 22, dt);
    if (mouth.current) mouth.current.scale.set(0.085, 0.02 + state_.mouth * 0.07, 0.03);

    if (head.current) head.current.position.y = HEAD_HEIGHT + (calm ? 0 : Math.sin(t0 * 1.6 + phase) * 0.012);
    if (eyes.current) {
      const blinkClock = (t0 + look.phase * 7) % 3.8;
      eyes.current.scale.y = !calm && blinkClock < 0.12 ? 0.12 : 1;
    }

    // Raised hand: the right arm lifts and waves.
    const armTarget = s.hand ? -2.85 : -1.2;
    state_.arm = calm ? armTarget : damp(state_.arm, armTarget, 9, dt);
    if (rightArm.current) {
      rightArm.current.rotation.x = state_.arm;
      rightArm.current.rotation.z = s.hand && !calm ? Math.sin(t0 * 7 + phase) * 0.32 : 0;
    }

    // The spotlight beam while speaking; the gold ring pulses while invited (a still ring when motion is reduced).
    if (beam.current) {
      beamMaterial.opacity = 0.11 * state_.speak;
      beam.current.visible = state_.speak > 0.02;
    }
    if (pulse.current) {
      const beat = calm ? 0.8 : 0.55 + 0.35 * Math.sin(t0 * 4.5);
      pulseMaterial.opacity = s.invited ? beat : 0;
      pulse.current.visible = s.invited;
    }

    // The name label follows the head on screen. It is a real DOM element, so it stays crisp and selectable.
    const el = labelEls.current.get(s.userId);
    if (el) {
      scratch.set(state_.x, 2.05 * Math.max(0.2, state_.appear), state_.z).project(state.camera);
      const visible = scratch.z < 1 && state_.appear > 0.4;
      el.style.opacity = visible ? "1" : "0";
      if (visible) {
        const px = (scratch.x * 0.5 + 0.5) * size.width;
        const py = (-scratch.y * 0.5 + 0.5) * size.height;
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }
  });

  const detail = assets.detail;
  const hair = pick(look.hair);
  const skin = pick(look.skin);
  const shirt = pick(look.shirt);
  const chair = pick("#6b5a4a");

  return (
    <group ref={group} dispose={null}>
      {/* The talk-share ring and the "your turn" ring, on the floor. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={geo.ring} material={assets.basic(theme.ring, 0.9)} />
      {fillStep > 0 && <mesh rotation-x={-Math.PI / 2} position-y={0.025} geometry={assets.fillRing(fillStep)} material={assets.basic(theme.accent, 0.95)} />}
      <mesh ref={pulse} rotation-x={-Math.PI / 2} position-y={0.03} geometry={geo.pulseRing} material={pulseMaterial} visible={false} />
      {!shadows && <mesh rotation-x={-Math.PI / 2} position-y={0.012} geometry={geo.blob} material={assets.basic("#000000", 0.22)} />}

      {/* Chair, behind the character (the character looks along local +z). */}
      <mesh position={[0, 0.45, -0.05]} geometry={geo.seat} material={chair} castShadow={shadows} />
      <mesh position={[0, 0.78, -0.4]} geometry={geo.chairBack} material={chair} castShadow={shadows} />
      <mesh position={[0, 0.22, -0.05]} geometry={geo.chairPost} material={chair} />

      {/* Body. */}
      <mesh position={[0, 0.8, 0]} geometry={geo.torso} material={shirt} castShadow={shadows} />
      {/* Left arm rests on the table; the right one is the raised hand. */}
      <group position={[-0.34, 1.0, 0.04]} rotation-x={-1.2}>
        <mesh position={[0, -0.25, 0]} geometry={geo.arm} material={shirt} />
        <mesh position={[0, -0.47, 0]} geometry={geo.hand} material={skin} />
      </group>
      <group ref={rightArm} position={[0.34, 1.0, 0.04]} rotation-x={-1.2}>
        <mesh position={[0, -0.25, 0]} geometry={geo.arm} material={shirt} />
        <mesh position={[0, -0.47, 0]} geometry={geo.hand} material={skin} />
      </group>

      {/* Head. */}
      <group ref={head} position={[0, HEAD_HEIGHT, 0]}>
        <mesh geometry={geo.head} material={skin} castShadow={shadows} />
        <group ref={eyes} position={[0, 0.06, 0.255]}>
          <mesh position={[-0.1, 0, 0]} geometry={geo.eye} material={assets.solid("#ffffff")} />
          <mesh position={[0.1, 0, 0]} geometry={geo.eye} material={assets.solid("#ffffff")} />
          <mesh position={[-0.1, 0, 0.045]} geometry={geo.pupil} material={assets.solid("#1b1b1f")} />
          <mesh position={[0.1, 0, 0.045]} geometry={geo.pupil} material={assets.solid("#1b1b1f")} />
        </group>
        {detail && (
          <>
            <mesh position={[-0.1, 0.17, 0.25]} rotation-z={0.12} geometry={geo.brow} material={hair} />
            <mesh position={[0.1, 0.17, 0.25]} rotation-z={-0.12} geometry={geo.brow} material={hair} />
          </>
        )}
        <mesh ref={mouth} position={[0, -0.09, 0.275]} geometry={geo.mouth} material={assets.solid("#9b3340")} scale={[0.085, 0.034, 0.03]} />

        {look.hairStyle !== "bald" && <mesh position={[0, 0.0, -0.025]} rotation-x={-0.72} geometry={geo.hairCap} material={hair} castShadow={shadows} />}
        {look.hairStyle === "bun" && <mesh position={[0, 0.33, -0.15]} geometry={geo.hairBun} material={hair} />}
        {look.hairStyle === "long" && <mesh position={[0, -0.18, -0.13]} geometry={geo.hairLong} material={hair} />}
        {look.hairStyle === "curly" && detail && [[-0.26, 0.12], [0.26, 0.12], [-0.16, 0.27], [0.16, 0.27], [0, 0.31]].map(([cx, cy], index) => (
          <mesh key={index} position={[cx, cy, -0.06]} geometry={geo.hairCurl} material={hair} />
        ))}

        {detail && look.accessory === "glasses" && (
          <group position={[0, 0.06, 0.29]}>
            <mesh position={[-0.1, 0, 0]} geometry={geo.glassesRing} material={assets.solid("#2b2b30")} />
            <mesh position={[0.1, 0, 0]} geometry={geo.glassesRing} material={assets.solid("#2b2b30")} />
            <mesh geometry={geo.glassesBridge} material={assets.solid("#2b2b30")} />
          </group>
        )}
        {detail && look.accessory === "headband" && (
          <mesh position={[0, 0.17, 0]} rotation-x={Math.PI / 2} geometry={geo.headband} material={pick("#e0b94f")} />
        )}
      </group>

      {/* The speaking beam. */}
      <mesh ref={beam} position={[0, 2.2, 0]} geometry={geo.beam} material={beamMaterial} visible={false} />
    </group>
  );
}
