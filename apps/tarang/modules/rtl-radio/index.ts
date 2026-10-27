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
  openRecording: (id: string) => native.openRecording(id),
  deleteRecording: (id: string) => native.deleteRecording(id),
  /** State updates a few times a second; list fields (hits, favorites, survey, rdsNames) only when they change. */
  subscribe: (listener: (s: Partial<RadioState>) => void) => native.addListener('onState', listener),
};

export type TuneEvent = NativeSyntheticEvent<{ freq: number; drag: boolean; b?: boolean }>;

type TuneViewProps = ViewProps & { onTune?: (e: TuneEvent) => void };

/** Live spectrum + waterfall: tap to tune, drag to fine-tune, long-press to place channel B. */
export const SpectrumView: ComponentType<TuneViewProps> = requireNativeViewManager('RtlRadio');

/** Band activity chart from the last sweep: tap to tune to the strongest signal under your finger. */
export const SweepView: ComponentType<TuneViewProps> = requireNativeViewManager('RtlRadioSweep');
