"use client";

import { useMemo } from "react";
import type { Assets } from "./assets";
import { themeColors } from "./assets";
import { ringRadius, tableRadius } from "./seat3d";
import type { Theme } from "./theme";

/** The room: a floor, a round wooden table on a pedestal, and a calm disc at the centre where the discussion's status is shown. */
export function TableModel({ assets, theme, count, shadows }: { assets: Assets; theme: Theme; count: number; shadows: boolean }) {
  const colors = useMemo(() => themeColors(theme), [theme]);
  const table = tableRadius(count);
  const floor = ringRadius(count) + 1.9;
  const wood = assets.solid("#b98b5e");
  const woodLight = assets.solid("#c99b6d");
  const floorMaterial = assets.solid(colors.floor);
  const rugMaterial = assets.solid(colors.rug);
  const centreMaterial = assets.solid(colors.centre);
  return (
    <group dispose={null}>
      <mesh rotation-x={-Math.PI / 2} geometry={assets.geo.disc} material={floorMaterial} scale={[floor, floor, 1]} receiveShadow={shadows} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} geometry={assets.geo.disc} material={rugMaterial} scale={[ringRadius(count) + 0.9, ringRadius(count) + 0.9, 1]} receiveShadow={shadows} />
      <mesh position={[0, 0.375, 0]} geometry={assets.geo.pedestal} material={wood} castShadow={shadows} />
      <mesh position={[0, 0.75, 0]} geometry={assets.geo.tableTop} material={wood} scale={[table, 1, table]} castShadow={shadows} receiveShadow={shadows} />
      <mesh position={[0, 0.8, 0]} geometry={assets.geo.tableEdge} material={woodLight} scale={[table * 0.97, 1, table * 0.97]} receiveShadow={shadows} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.827, 0]} geometry={assets.geo.disc} material={centreMaterial} scale={[Math.min(0.9, table * 0.4), Math.min(0.9, table * 0.4), 1]} />
    </group>
  );
}

