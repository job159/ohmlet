/**
 * Mesh-builder registry for part families added after the original
 * `dispatch` switch: a module in src/three/meshes/ext/*.mesh.ts calls
 * registerMeshBuilder(shape, …) at import time and is picked up
 * automatically (import.meta.glob in component-meshes.ts). Built-in shapes
 * always win over registered ones.
 */
import type * as THREE from 'three'
import type { ComponentInstance } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import type { RoutedComponent } from '../internal/wire-router'
import type { BuildResult } from './shared'

export type MeshBuilder = (
  comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
  routed?: RoutedComponent,
) => BuildResult

interface Registered {
  minPins: number
  build: MeshBuilder
}

const builders = new Map<string, Registered>()

export function registerMeshBuilder(shape: string, minPins: number, build: MeshBuilder): void {
  builders.set(shape, { minPins, build })
}

export function registeredMeshBuilder(shape: string | undefined, pinCount: number): MeshBuilder | null {
  if (!shape) return null
  const r = builders.get(shape)
  return r && pinCount >= r.minPins ? r.build : null
}

export function registeredMeshShapes(): string[] {
  return [...builders.keys()]
}
