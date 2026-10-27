import { requireNativeModule, requireNativeViewManager, type EventSubscription } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

import type { RadioCommand, RadioState } from './types';

export * from './types';

type RtlRadioNative = {
  getState(): RadioState;
  command(cmd: RadioCommand): void;
  start(): Promise<boolean>;
  stop(): void;
  locate(fresh: boolean): Promise<{ lat: number; lon: number; accuracy: number } | null>;
  openRecording(id: string): void;
  deleteRecording(id: string): void;
  addListener(event: 'onState', listener: (s: Partial<RadioState>) => void): EventSubscription;
};

const native = requireNativeModule<RtlRadioNative>('RtlRadio');

export const Radio = {
  getState: () => native.getState(),
  command: (cmd: RadioCommand) => native.command(cmd),
  start: () => native.start(),
  stop: () => native.stop(),
  /**
   * Asks for location permission and gives the engine the phone's position; null if denied or unavailable.
   * [fresh] skips fixes more than a minute old (otherwise anything from the last half hour will do).
   */
  locate: (fresh = false) => native.locate(fresh),
  openRecording: (id: string) => native.openRecording(id),
  deleteRecording: (id: string) => native.deleteRecording(id),
  /** State updates a few times a second; lists (hits, favorites, survey, rdsNames, planes, sensors) only when they change. */
  subscribe: (listener: (s: Partial<RadioState>) => void) => native.addListener('onState', listener),
};

export type TuneEvent = NativeSyntheticEvent<{ freq: number; drag: boolean; b?: boolean }>;

type TuneViewProps = ViewProps & { onTune?: (e: TuneEvent) => void };

/** Live spectrum + waterfall: tap to tune, drag to fine-tune, long-press to place channel B. */
export const SpectrumView: ComponentType<TuneViewProps> = requireNativeViewManager('RtlRadio');

/** Band activity chart from the last sweep: tap to tune to the strongest signal under your finger. */
export const SweepView: ComponentType<TuneViewProps> = requireNativeViewManager('RtlRadioSweep');

/** hex is "" when the tap missed every plane. */
export type SelectEvent = NativeSyntheticEvent<{ hex: string }>;

/** Camera request for the map: moves once per distinct token. */
export type MapFocus = { lat: number; lon: number; zoom?: number; token: number };

type RadarViewProps = ViewProps & { selected?: string | null; focus?: MapFocus | null; onSelect?: (e: SelectEvent) => void };

/** Live plane map: drag, pinch and double-tap to move around, tap a plane to select it. */
export const RadarView: ComponentType<RadarViewProps> = requireNativeViewManager('RtlRadioMap');
