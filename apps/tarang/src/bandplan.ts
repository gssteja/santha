// What a signal found by the band survey probably is: a US band plan good enough to label peaks.
// TV pilots sit 0.31 MHz above a channel's lower edge, so a channel is named from the pilot's position.

type Band = [lo: number, hi: number, name: string];

const BANDS: Band[] = [
  [0.53e6, 1.7e6, 'AM broadcast'],
  [2.5e6, 2.5e6 + 1, 'WWV time'],
  [26.965e6, 27.405e6, 'CB radio'],
  [28e6, 29.7e6, '10 m ham'],
  [50e6, 54e6, '6 m ham'],
  [88e6, 108e6, 'FM broadcast'],
  [108e6, 118e6, 'Air navigation (VOR/ILS)'],
  [118e6, 137e6, 'Airband voice'],
  [137e6, 138e6, 'Weather satellites (Meteor-M)'],
  [144e6, 148e6, '2 m ham'],
  [151.82e6, 154.6e6, 'MURS / business'],
  [156e6, 162.025e6, 'Marine VHF'],
  [162.4e6, 162.55e6 + 1, 'NOAA weather'],
  [148e6, 174e6, 'VHF business / public safety'],
  [216e6, 225e6, '1.25 m ham / misc'],
  [225e6, 400e6, 'Military aviation'],
  [406e6, 406.1e6, 'Emergency beacons (406)'],
  [420e6, 450e6, '70 cm ham'],
  [462.55e6, 462.725e6 + 1, 'FRS / GMRS'],
  [467.55e6, 467.725e6 + 1, 'FRS / GMRS repeater input'],
  [450e6, 470e6, 'UHF business / public safety'],
  [617e6, 652e6, 'LTE 600 MHz (downlink)'],
  [729e6, 746e6, 'LTE 700 MHz (downlink)'],
  [746e6, 757e6, 'LTE band 13 (downlink)'],
  [758e6, 769e6, 'FirstNet (public safety LTE)'],
  [769e6, 775e6, '700 MHz public safety'],
  [775e6, 776e6, '700 MHz public safety'],
  [851e6, 869e6, '800 MHz trunked radio'],
  [869e6, 894e6, 'Cellular 850 (downlink)'],
  [896e6, 901e6, '900 MHz SMR'],
  [902e6, 928e6, '902-928 MHz unlicensed (ISM)'],
  [929e6, 932e6, 'Pagers'],
  [935e6, 940e6, '900 MHz SMR'],
  [978e6, 978e6 + 1, 'UAT (aircraft)'],
  [1090e6, 1090e6 + 1, 'ADS-B (aircraft)'],
  [1240e6, 1300e6, '23 cm ham'],
  [1575.42e6 - 1e6, 1575.42e6 + 1e6, 'GPS L1'],
];

function tvChannel(f: number): number | null {
  // VHF low 2-6, VHF high 7-13, UHF 14-36 (post-repack)
  const low: [number, number][] = [[54e6, 2], [60e6, 3], [66e6, 4], [76e6, 5], [82e6, 6]];
  for (const [lo, ch] of low) if (f >= lo && f < lo + 6e6) return ch;
  if (f >= 174e6 && f < 216e6) return 7 + Math.floor((f - 174e6) / 6e6);
  if (f >= 470e6 && f < 608e6) return 14 + Math.floor((f - 470e6) / 6e6);
  return null;
}

export function bandName(f: number): string {
  for (const [lo, hi, name] of BANDS) if (f >= lo && f < hi) return name;
  const tv = tvChannel(f);
  if (tv != null) return `TV channel ${tv}`;
  return '';
}
