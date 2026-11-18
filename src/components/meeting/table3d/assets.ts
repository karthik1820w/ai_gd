import * as THREE from "three";
import type { Tier } from "./seat3d";
import type { Theme } from "./theme";

/**
 * Everything the scene draws with, built once per quality tier and theme and disposed together.
 * Geometries are shared by every character. Materials are shared too: one per colour, plus a
 * see-through twin for people who have lost their connection.
 */
export type Assets = {
  tier: Tier;
  detail: boolean;
  geo: ReturnType<typeof buildGeometries>;
  solid: (hex: string) => THREE.Material;
  ghost: (hex: string) => THREE.Material;
  basic: (hex: string, opacity: number) => THREE.MeshBasicMaterial;
  fillRing: (step: number) => THREE.RingGeometry;
  dispose: () => void;
};

export const FILL_STEPS = 48;

function segments(tier: Tier) {
  return tier === "high" ? 28 : tier === "medium" ? 18 : 10;
}

function buildGeometries(tier: Tier) {
  const n = segments(tier);
  const half = Math.max(6, Math.floor(n / 2));
  return {
    seat: new THREE.BoxGeometry(0.8, 0.1, 0.8),
    chairBack: new THREE.BoxGeometry(0.72, 0.5, 0.08),
    chairPost: new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8),
    torso: new THREE.CapsuleGeometry(0.27, 0.14, 4, n),
    head: new THREE.SphereGeometry(0.3, n, half),
    eye: new THREE.SphereGeometry(0.06, 12, 8),
    pupil: new THREE.SphereGeometry(0.03, 8, 6),
    brow: new THREE.BoxGeometry(0.1, 0.022, 0.022),
    mouth: new THREE.SphereGeometry(1, 12, 8),
    // A hemisphere, tilted back in Character.tsx so the hairline sits above the brows and the face stays visible.
    hairCap: new THREE.SphereGeometry(0.325, n, half, 0, Math.PI * 2, 0, Math.PI / 2),
    hairBun: new THREE.SphereGeometry(0.13, 12, 8),
    hairCurl: new THREE.SphereGeometry(0.11, 10, 8),
    hairLong: new THREE.CapsuleGeometry(0.2, 0.35, 4, 12),
    glassesRing: new THREE.TorusGeometry(0.075, 0.011, 8, 18),
    glassesBridge: new THREE.BoxGeometry(0.06, 0.012, 0.012),
    headband: new THREE.TorusGeometry(0.31, 0.026, 8, 24),
    arm: new THREE.CapsuleGeometry(0.075, 0.32, 3, 8),
    hand: new THREE.SphereGeometry(0.09, 10, 8),
    tableTop: new THREE.CylinderGeometry(1, 1, 0.12, Math.max(32, n * 2)),
    tableEdge: new THREE.CylinderGeometry(1, 1, 0.05, Math.max(32, n * 2)),
    pedestal: new THREE.CylinderGeometry(0.4, 0.55, 0.75, 20),
    disc: new THREE.CircleGeometry(1, Math.max(32, n * 2)),
    ring: new THREE.RingGeometry(0.6, 0.7, 40),
    pulseRing: new THREE.RingGeometry(0.82, 0.94, 40),
    beam: new THREE.ConeGeometry(0.62, 2.4, n, 1, true),
    blob: new THREE.CircleGeometry(0.58, 20),
  };
}

export function createAssets(tier: Tier): Assets {
  const geo = buildGeometries(tier);
  const solids = new Map<string, THREE.Material>();
  const ghosts = new Map<string, THREE.Material>();
  const basics = new Map<string, THREE.MeshBasicMaterial>();
  const rings = new Map<number, THREE.RingGeometry>();
  const cheap = tier === "low";

  const make = (hex: string, ghost: boolean): THREE.Material => {
    const params = { color: hex, transparent: ghost, opacity: ghost ? 0.45 : 1, depthWrite: !ghost };
    return cheap ? new THREE.MeshLambertMaterial(params) : new THREE.MeshStandardMaterial({ ...params, roughness: 0.85, metalness: 0 });
  };

  return {
    tier,
    detail: tier !== "low",
    geo,
    solid: (hex) => {
      let material = solids.get(hex);
      if (!material) { material = make(hex, false); solids.set(hex, material); }
      return material;
    },
    ghost: (hex) => {
      let material = ghosts.get(hex);
      if (!material) { material = make(hex, true); ghosts.set(hex, material); }
      return material;
    },
    basic: (hex, opacity) => {
      const key = `${hex}|${opacity}`;
      let material = basics.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
        basics.set(key, material);
      }
      return material;
    },
    // The talk-share arc, in 1/48ths of a circle, built on demand and then shared.
    fillRing: (step) => {
      const clamped = Math.max(0, Math.min(FILL_STEPS, Math.round(step)));
      let ring = rings.get(clamped);
      if (!ring) {
        ring = new THREE.RingGeometry(0.6, 0.7, 40, 1, Math.PI / 2, Math.max(0.0001, (clamped / FILL_STEPS) * Math.PI * 2));
        rings.set(clamped, ring);
      }
      return ring;
    },
    dispose: () => {
      Object.values(geo).forEach((geometry) => geometry.dispose());
      rings.forEach((ring) => ring.dispose());
      [solids, ghosts, basics].forEach((cache) => cache.forEach((material) => material.dispose()));
      solids.clear(); ghosts.clear(); basics.clear(); rings.clear();
    },
  };
}

/** Parse a theme colour once per theme change. */
export function themeColors(theme: Theme) {
  return {
    floor: new THREE.Color(theme.ring).lerp(new THREE.Color(theme.card), 0.35).getStyle(),
    rug: new THREE.Color(theme.card).getStyle(),
    centre: new THREE.Color(theme.card).lerp(new THREE.Color(theme.bg), 0.2).getStyle(),
  };
}
