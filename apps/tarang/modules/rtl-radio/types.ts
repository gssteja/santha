export type Mode = 'AM' | 'NFM' | 'WFM' | 'USB' | 'LSB' | 'CW';

export type Favorite = { f: number; mode: Mode; bw: number; label: string };

export type Hit = { t: number; f: number; mode: Mode; bw: number; label: string; snr: number; group: string };

export type Survey = { t: number; stations: { f: number; snr: number }[] };

export type VfoB = { freq: number; mode: Mode; bw: number; squelch: number; label: string; snr: number; open: boolean; inView: boolean };

export type SweepPeak = { f: number; snr: number; width: number; mode: Mode; label: string };

export type SweepResult = { t: number; start: number; stop: number; step: number; peaks: SweepPeak[] };

export type Recording = { id: string; name: string; seconds: number };

export type AppMode = 'radio' | 'planes' | 'sensors' | 'weather' | 'aprs' | 'acars' | 'p25';

/** A decoded NOAA Weather Radio alert (times are epoch ms). */
export type WeatherAlert = {
  code: string;
  event: string;
  level: 'warning' | 'watch' | 'statement' | 'test';
  org: string;
  places: string[];
  mine: boolean;
  issued: number;
  expires: number;
  station: string;
  received: number;
  raw: string;
  freq: number;
  bursts: number;
};

export type AprsStation = {
  call: string;
  first: number;
  last: number;
  count: number;
  via: string;
  raw: string;
  lat?: number;
  lon?: number;
  dist?: number; // statute miles from the phone
  bearing?: number;
  symbol?: string; // table + code, e.g. "/>"
  comment?: string;
  course?: number;
  speedMph?: number;
  altFt?: number;
  status?: string;
  weather?: Record<string, number>; // windDir, windMph, gustMph, tempF, rain1hIn, rain24hIn, rainTodayIn, humidity, pressureMb
};

export type AcarsMessage = {
  t: number;
  freq: number;
  mode: string;
  reg: string;
  ack: string;
  label: string;
  labelName: string;
  block: string;
  down: boolean;
  msgno: string;
  flight: string;
  text: string;
  level: number;
};

export type Decode = {
  listen: boolean;
  weather: {
    available: boolean; // NOAA Weather Radio exists only in the US and Canada
    freq: number;
    stations: { f: number; snr: number }[];
    alerts: WeatherAlert[];
    tone: boolean;
    alerting: boolean;
    county: { fips: string; name: string; manual: boolean } | null;
  };
  aprs: { freq: number; packets: number; stations: AprsStation[]; log: { t: number; kind: string; from: string; to?: string; text: string }[] };
  acars: { channels: number[]; count: number; messages: AcarsMessage[] };
};

/** A P25 talkgroup as heard on the control channel (t: epoch ms of the last grant; enc: 1 / 0 / -1 unknown). */
export type P25Talkgroup = {
  id: number;
  name: string;
  cat: string;
  fav: boolean;
  lockout: boolean;
  t: number;
  calls: number;
  src: number;
  enc: number;
  emergency: boolean;
  f: number;
  slot: number;
  tdma: boolean;
};

/** The call being followed: enc is 1 encrypted, 0 confirmed clear (only then is it played), -1 not known yet. */
export type P25Call = {
  tg: number;
  name: string;
  cat: string;
  fav: boolean;
  lockout: boolean;
  src: number;
  f: number;
  slot: number;
  tdma: boolean;
  enc: number;
  algid: number;
  emergency: boolean;
  dur: number;
  frames: number;
  talking: boolean;
};

export type P25LogEntry = P25Call & { t: number; end: string };

export type P25 = {
  mode: 'off' | 'hunt' | 'control' | 'voice';
  system: string;
  cc: number;
  nac: number;
  wacn: number;
  sysid: number;
  rfss: number;
  site: number;
  grants: number;
  hold: number;
  ccs: number[];
  adjacent: { f: number; site: string }[];
  patches: { sg: number; tgs: number[] }[];
  call: P25Call | null;
  tgs: P25Talkgroup[];
  log: P25LogEntry[];
  rx: {
    path: 'c4fm' | 'cqpsk';
    afc: number;
    quality: number;
    syncs: number;
    frames: number;
    nidFails: number;
    tsbks: number;
    tsbkFails: number;
    p2: { locked: boolean; slot: number; macs: number; macFails: number; voice: number };
    audioMs: number;
    want: number;
    retunes: number;
  };
  sites: { index: number; name: string; nac: number; ccs: number[] }[];
  settings: { site: number; ccs: number[]; custom: boolean; listen: boolean; favoritesOnly: boolean; hangMs: number; hold: number };
};

/** Every named talkgroup (preset + the user's), for browsing and favorites / lockouts. */
export type P25DirEntry = { id: number; name: string; cat: string; desc: string; enc: boolean; fav: boolean; lockout: boolean };

/** One aircraft (alt ft, gs kt, vr ft/min, dist nm from the phone, seen s ago). */
export type Aircraft = {
  hex: string;
  flight: string;
  alt: number | null;
  gnssAlt: number | null;
  gs: number | null;
  track: number | null;
  heading: number | null;
  vr: number | null;
  squawk: string | null;
  emergency: number;
  category: number;
  ground: boolean;
  lat: number | null;
  lon: number | null;
  dist: number | null;
  bearing: number | null;
  rssi: number;
  messages: number;
  seen: number;
  seenPos: number | null;
};

export type Planes = { aircraft: Aircraft[]; tracked: number; withPos: number; messages: number; rate: number };

/** One rtl_433 device: a model + id + channel, with its latest readings (times are epoch ms). */
export type SensorDevice = {
  key: string;
  model: string;
  id: string;
  channel: string;
  first: number;
  last: number;
  count: number;
  readings: Record<string, number | string | boolean>;
  freq: number | null;
  rssi: number | null;
  snr: number | null;
  protocol: number;
};

export type Sensors = {
  messages: number;
  devices: SensorDevice[];
  band: number;
  bands: number[];
  hopSeconds: number;
  nextHop: number | null;
  decoders: number;
};

export type RadioState = {
  running: boolean;
  status: 'off' | 'starting' | 'radio' | 'error';
  error: string;
  needsPermission: boolean;
  device: string;
  freq: number;
  hwCenter: number | null;
  mode: Mode;
  bw: number;
  label: string;
  squelch: number;
  gain: number | null;
  gains: number[];
  ppm: number;
  stereo: boolean;
  nr: boolean;
  stereoActive: boolean;
  directSampling: boolean;
  snr: number;
  open: boolean;
  noise: number;
  vfoB: VfoB | null;
  recording: { name: string; seconds: number } | null;
  scan: { state: 'search' | 'hold' | 'survey' | 'sweep'; group: string; name: string; progress: string; ignored: number } | null;
  rds: { pi: string; ps: string; rt: string; pty: string; synced: boolean; groups: number } | null;
  stats: { blocks: number; msPerBlock: number; bytesIn: number; dropped: number; streaming: boolean };
  appMode: AppMode;
  receiver: { lat: number; lon: number } | null;
  planes: Planes | null;
  sensors: Sensors | null;
  decode: Decode | null;
  p25: P25 | null;
  p25Dir: P25DirEntry[] | null;
  listsVersion: number;
  hits: Hit[];
  favorites: Favorite[];
  survey: Record<string, Survey>;
  rdsNames: Record<string, string>;
  sweep: SweepResult | null;
  recordings: Recording[];
};

export type ScanChannel = { f: number; label?: string; mode?: Mode; bw?: number };

export type RadioCommand =
  | { action: 'tune'; f: number; mode?: Mode; bw?: number; label?: string }
  | { action: 'mode'; mode: Mode }
  | { action: 'bw'; bw: number }
  | { action: 'squelch'; db: number }
  | { action: 'gain'; db: number | null }
  | { action: 'ppm'; ppm: number }
  | { action: 'stereo'; on: boolean }
  | { action: 'nr'; on: boolean }
  | { action: 'scan' | 'survey'; group: string; name: string; mode: Mode; channels: ScanChannel[]; threshold?: number }
  | { action: 'scan_stop' | 'scan_skip' | 'scan_ignore' | 'scan_stay' | 'strongest' | 'vfo_b_off' | 'swap' }
  | { action: 'vfo_b'; f: number; mode?: Mode; bw?: number; squelch?: number; label?: string }
  | { action: 'vfo_b_squelch'; db: number }
  | { action: 'record'; on: boolean }
  | { action: 'sweep'; start: number; stop: number }
  | { action: 'fav_add'; f: number; mode: Mode; bw: number; label?: string }
  | { action: 'fav_remove'; f: number }
  | { action: 'app_mode'; mode: AppMode }
  | { action: 'location'; lat: number; lon: number }
  | { action: 'sensors_clear' }
  | { action: 'decode_listen'; on: boolean }
  | { action: 'decode_clear'; what: 'weather' | 'aprs' | 'acars' }
  | { action: 'wx_county'; fips: string | null }
  | { action: 'p25_listen' | 'p25_favorites_only'; on: boolean }
  | { action: 'p25_hang'; ms: number }
  | { action: 'p25_site'; index: number }
  | { action: 'p25_ccs'; mhz: number[] }
  | { action: 'p25_tg'; id: number; name?: string; fav?: boolean; lockout?: boolean }
  | { action: 'p25_import'; text: string }
  | { action: 'p25_names_reset' | 'p25_skip' }
  | { action: 'p25_hold'; tg: number };
