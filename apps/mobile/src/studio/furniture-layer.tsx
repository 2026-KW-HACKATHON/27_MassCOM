import { useRef } from 'react';
import { Image, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import type { FurniturePlacement, FurnitureSnapshot, PlacedFurnitureItem } from './studio-api';
import { clampPosition } from './studio-furniture';

const furnitureCells: Record<string, number> = {
  'oak-chair': 0, 'round-table': 1, 'leafy-plant': 2,
  'floor-lamp': 3, bookcase: 4, 'mushroom-lamp': 5,
};
export const hasFurnitureArt = (assetId: string | null | undefined): boolean => assetId !== null && assetId !== undefined && assetId in furnitureCells;

export function FurnitureArt({ assetId, name, size = 72, onLoad }: { assetId: string | null; name: string; size?: number; onLoad?: () => void }) {
  const cell = assetId === null ? undefined : furnitureCells[assetId];
  if (cell === undefined) return <Text numberOfLines={2} style={styles.label}>{name}</Text>;
  return <View style={{ width: size, height: size, overflow: 'hidden' }}>
    <Image source={require('../../assets/images/room/furniture-atlas.png')} resizeMode="stretch"
      onLoad={onLoad}
      style={{ position: 'absolute', width: size * 3, height: size * 2,
        left: -(cell % 3) * size, top: -Math.floor(cell / 3) * size }} />
  </View>;
}

function Piece({ placement, name, assetId, width, height, selected, onSelect, onMove, onLoad }: {
  placement: FurniturePlacement; name: string; assetId: string | null; width: number; height: number; selected: boolean;
  onSelect?: () => void; onMove?: (x: number, y: number) => void; onLoad?: () => void;
}) {
  const start = useRef<{ pageX: number; pageY: number; x: number; y: number } | null>(null);
  function begin(event: GestureResponderEvent) {
    start.current = { pageX: event.nativeEvent.pageX, pageY: event.nativeEvent.pageY, x: placement.x, y: placement.y };
    onSelect?.();
  }
  function move(event: GestureResponderEvent) {
    if (!start.current || !onMove) return;
    onMove(clampPosition(start.current.x + (event.nativeEvent.pageX - start.current.pageX) / width),
      clampPosition(start.current.y + (event.nativeEvent.pageY - start.current.pageY) / height));
  }
  return <View accessibilityLabel={`${name} 배치됨`} pointerEvents={onMove ? 'auto' : 'none'} style={[styles.piece, {
    left: placement.x * width - 42, top: placement.y * height - 78,
    transform: [{ rotate: `${placement.rotation}deg` }],
  }, selected && styles.selected]}
    onStartShouldSetResponder={() => !!onMove} onMoveShouldSetResponder={() => !!onMove}
    onResponderGrant={begin} onResponderMove={move} onResponderRelease={() => { start.current = null; }}>
    <FurnitureArt assetId={assetId} name={name} size={80} onLoad={onLoad} />
  </View>;
}

export function FurnitureLayer({ placements, owned, placedItems, width, height, selectedId, onSelect, onMove, onAssetLoad }: {
  placements: readonly FurniturePlacement[]; owned?: FurnitureSnapshot; placedItems?: PlacedFurnitureItem[]; width: number; height: number;
  selectedId?: string; onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void; onAssetLoad?: (id: string) => void;
}) {
  if (!owned && !placedItems) return null;
  const inventory = new Map([...(placedItems ?? []), ...(owned?.inventory ?? [])].map((entry) => [entry.id, entry.itemId]));
  const catalog = new Map([...(placedItems ?? []), ...(owned?.catalog ?? [])].map((item) => ['itemId' in item ? item.itemId : item.id, item]));
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {placements.map((placement) => {
      const itemId = inventory.get(placement.inventoryId);
      const item = itemId && catalog.get(itemId);
      return item ? <Piece key={placement.inventoryId} placement={placement} name={item.name} assetId={item.assetId} width={width} height={height}
        selected={selectedId === placement.inventoryId} onSelect={onSelect ? () => onSelect(placement.inventoryId) : undefined}
        onMove={onMove ? (x, y) => onMove(placement.inventoryId, x, y) : undefined}
        onLoad={onAssetLoad ? () => onAssetLoad(placement.inventoryId) : undefined} /> : null;
    })}
  </View>;
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', width: 84, height: 84, borderRadius: 12,
    borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: '#0C9F86', borderWidth: 3 },
  label: { color: '#3B2B1B', fontWeight: '800', fontSize: 11, textAlign: 'center' },
});
