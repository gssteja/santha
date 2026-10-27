import { useEffect, useState } from 'react';

import { Radio, type RadioState } from '../modules/rtl-radio';

/** Live radio state: the native snapshot, kept current by the engine's state events. */
export function useRadio(): RadioState {
  const [state, setState] = useState<RadioState>(() => Radio.getState());
  useEffect(() => {
    const sub = Radio.subscribe((partial) => setState((prev) => ({ ...prev, ...partial })));
    setState(Radio.getState());
    return () => sub.remove();
  }, []);
  return state;
}
