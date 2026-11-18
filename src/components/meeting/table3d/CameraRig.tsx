"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { damp, focusPose, fovForAspect, overviewPose, type SeatWorld } from "./seat3d";

/** How quickly the camera settles: about 95% of the way in 3 / LAMBDA = 0.67 s. */
const LAMBDA = 4.5;

/**
 * Glides to the speaker's character when `focus` is set, and back to the overview when it clears.
 * `focus` already carries the existing 400 ms takeover and 1500 ms hold from FocusTracker, so there are
 * no timers here. With reduced motion the camera cuts to the new pose instead of gliding.
 */
export function CameraRig({ count, focus, reduced }: { count: number; focus: SeatWorld | null; reduced: boolean }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const pose = useMemo(() => (focus ? focusPose(focus) : overviewPose(count)), [focus, count]);
  const rig = useRef({ position: new THREE.Vector3(...pose.position), look: new THREE.Vector3(...pose.target), ready: false });
  const goal = useRef(pose);
  goal.current = pose;

  useEffect(() => {
    camera.fov = fovForAspect(size.width / Math.max(1, size.height));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  // Runs before the characters, so their labels are projected with this frame's camera.
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const { position, target } = goal.current;
    const r = rig.current;
    if (reduced || !r.ready) {
      r.position.set(...position);
      r.look.set(...target);
      r.ready = true;
    } else {
      r.position.set(damp(r.position.x, position[0], LAMBDA, dt), damp(r.position.y, position[1], LAMBDA, dt), damp(r.position.z, position[2], LAMBDA, dt));
      r.look.set(damp(r.look.x, target[0], LAMBDA, dt), damp(r.look.y, target[1], LAMBDA, dt), damp(r.look.z, target[2], LAMBDA, dt));
    }
    camera.position.copy(r.position);
    camera.lookAt(r.look);
    camera.updateMatrixWorld();
  }, -1);

  return null;
}
