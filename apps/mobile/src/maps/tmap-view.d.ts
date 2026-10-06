import type { Bounds, WalkingLeg } from '../../../api/src/real-world-contract';
import type { StyleProp, ViewStyle } from 'react-native';
export type MapCamera = { latitude: number; longitude: number; zoom: number };
export type MapMarker = { id: string; latitude: number; longitude: number; title: string; count?: number; state: 'unvisited' | 'visited' | 'complete' | 'external' };
export type TmapMapProps = {
  camera: MapCamera; markers: MapMarker[]; selectedId: string | null;
  route: WalkingLeg['geometry'] | null; padding: { top: number; right: number; bottom: number; left: number };
  active: boolean; style?: StyleProp<ViewStyle>;
  onReady?: () => void; onError?: (error: { code: string; retryable: boolean }) => void;
  onProviderReady?: (provider: 'TMAP' | 'NAVER') => void;
  onViewport?: (event: { bounds: Bounds; camera: MapCamera }) => void;
  onSelect?: (id: string) => void; onCluster?: (ids: string[]) => void;
};

/** Metro selects the platform implementation; this declaration lets TypeScript resolve the shared import. */
export declare function TmapMap(props: TmapMapProps): React.ReactElement;
