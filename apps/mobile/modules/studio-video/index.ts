import { requireNativeModule } from 'expo-modules-core';

type VideoRequest = {
  backgroundUri: string;
  avatarUri?: string;
  coinUri?: string;
  coinColors?: readonly string[];
  width: number;
  height: number;
  sceneHeight: number;
  sceneTop?: number;
  coinSizeRatio?: number;
  motionEnabled?: boolean;
};

type StudioVideoModule = {
  encodeAsync(request: VideoRequest): Promise<string>;
  cancelAsync(): Promise<void>;
  saveAsync(uri: string): Promise<boolean>;
  saveImageAsync(uri: string): Promise<boolean>;
};

export const studioVideo = requireNativeModule<StudioVideoModule>('MasscomStudioVideo');
