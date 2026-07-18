/* Blueprint Buddy — the display-unit boundary.
 *
 * THE rule: internal math is always millimetres and SI. Conversion to display
 * units happens HERE, exactly once, at render time — never inside a
 * computation, so rounding can never feed back into geometry or physics.
 * Every physical quantity the user sees must pass through one of these
 * formatters; a raw `${x} mm` template string anywhere else is a bug.
 * (The only exemptions are the SketchUp exports, which describe real
 * geometry and stay millimetre-based regardless of display mode.)
 *
 * Preferences (system / fraction precision / dual display) live in ONE
 * place — `prefs` below — synced from stored prefs and the active design.
 *
 * Imperial semantics:
 *   fmtLength      cut & overall dimensions -> reduced fractions ("29 1/2 in")
 *   fmtSmall       fine values (sag, movement, kerf, reveals, clearances)
 *                  -> DECIMAL inches ("0.11 in"), never fractions
 *   fmtBoardLength stock board lengths -> feet ("8 ft")
 *   fmtSheet       sheet goods -> "4 x 8 ft"
 *   fmtNominal     trade name first: "1x4 x 8 ft (3/4 x 3 1/2 in)"
 *   fmtWeight      lb   · fmtPointLoad lb   · fmtLinearLoad lb/ft
 *   fmtBoardFeet   board feet in BOTH systems (it is the trade unit);
 *                  metric adds m³ as a secondary
 *   fmtDeg         degrees everywhere (angles never convert)
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const IN = 25.4, FT = 304.8;
  const KG_LB = 2.2046226218, KGM_LBFT = KG_LB / 3.280839895;
  // Derived from the single shared board-foot constant (knowledge loads first).
  const M3_PER_BDFT = BB.K.BF_MM3 * 1e-9;

  const DEFAULTS = { system: 'imperial', precision: 16, dual: false };
  const prefs = { ...DEFAULTS };

  function normalizeSystem(s) {
    if (s === 'mm' || s === 'metric') return 'metric';
    if (s === 'in' || s === 'imperial') return 'imperial';
    return null;
  }
  function set(patch) {
    if (!patch || typeof patch !== 'object') return prefs;
    const sys = normalizeSystem(patch.system);
    if (sys) prefs.system = sys;
    if (typeof patch.precision === 'number' && patch.precision >= 2) prefs.precision = Math.round(patch.precision);
    if (patch.dual !== undefined) prefs.dual = !!patch.dual;
    return prefs;
  }
  const setSystem = s => set({ system: s });
  const get = () => ({ ...prefs });

  const r = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const trim0 = s => String(s).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

  /* Reduced fractional inches at the given denominator: "29 1/2". */
  function fracIn(mm, denom) {
    denom = denom || prefs.precision;
    const ticks = Math.round((mm / IN) * denom);
    const whole = Math.floor(ticks / denom);
    let num = ticks - whole * denom, den = denom;
    if (!num) return String(whole);
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(num, den);
    num /= g; den /= g;
    return (whole ? whole + ' ' : '') + num + '/' + den;
  }

  const opt = (o, k) => (o && o[k] !== undefined ? o[k] : prefs[k]);

  /* Assemble "primary (secondary)" when dual display is on. */
  function dualize(primary, secondary, o) {
    return opt(o, 'dual') && secondary ? `${primary} (${secondary})` : primary;
  }

  const mmText = mm => trim0(String(r(mm, 1))) + ' mm';
  const inFracText = (mm, o) => fracIn(mm, opt(o, 'precision')) + ' in';
  const inDecText = mm => trim0((mm / IN).toFixed(2)) + ' in';
  function ftText(mm) {
    const ft = mm / FT;
    const near = Math.round(ft);
    return (Math.abs(ft - near) < 0.05 ? String(near) : trim0(ft.toFixed(1))) + ' ft';
  }

  /* ---- lengths ---- */
  function fmtLength(mm, o) {
    if (typeof mm !== 'number' || !isFinite(mm)) return '—';
    return opt(o, 'system') === 'imperial'
      ? dualize(inFracText(mm, o), mmText(mm), o)
      : dualize(mmText(mm), inFracText(mm, o), o);
  }
  /* Fine values: decimal inches, never fractions. */
  function fmtSmall(mm, o) {
    if (typeof mm !== 'number' || !isFinite(mm)) return '—';
    return opt(o, 'system') === 'imperial'
      ? dualize(inDecText(mm), mmText(mm), o)
      : dualize(mmText(mm), inDecText(mm), o);
  }
  /* Drill callouts — pilots and bores (audit M-01): a number you can pick
   * out of a bit index. Imperial: the nearest standard fractional bit in
   * 1/64 in steps, reduced ("7/64 in"), never decimal inches. Metric stays
   * millimetres (metric bit sets run in 0.1/0.5 mm). Math stays mm. */
  function fmtDrill(mm, o) {
    if (typeof mm !== 'number' || !isFinite(mm) || mm <= 0) return '—';
    const bitText = () => {
      let n = Math.max(1, Math.round((mm / IN) * 64)), d = 64;
      while (n % 2 === 0 && d > 1) { n /= 2; d /= 2; }
      return (d === 1 ? String(n) : n + '/' + d) + ' in';
    };
    return opt(o, 'system') === 'imperial'
      ? dualize(bitText(), mmText(mm), o)
      : dualize(mmText(mm), bitText(), o);
  }
  function fmtBoardLength(mm, o) {
    if (typeof mm !== 'number' || !isFinite(mm)) return '—';
    return opt(o, 'system') === 'imperial'
      ? dualize(ftText(mm), Math.round(mm) + ' mm', o)
      : dualize(Math.round(mm) + ' mm', ftText(mm), o);
  }
  function fmtSheet(wMM, hMM, o) {
    const imp = `${trim0((Math.round(wMM / FT * 2) / 2).toFixed(1))} x ${trim0((Math.round(hMM / FT * 2) / 2).toFixed(1))} ft`;
    const met = `${Math.round(wMM)} × ${Math.round(hMM)} mm`;
    return opt(o, 'system') === 'imperial' ? dualize(imp, met, o) : dualize(met, imp, o);
  }
  /* Nominal lumber: the trade name leads in imperial, actuals lead in metric.
   * actual = {t, w} in mm; stockLenMM optional. */
  function fmtNominal(nominal, actual, stockLenMM, o) {
    const metr = `${r(actual.t, 1)} x ${r(actual.w, 1)}${stockLenMM ? ' x ' + Math.round(stockLenMM) : ''} mm`;
    if (opt(o, 'system') === 'imperial') {
      const acts = `${fracIn(actual.t, opt(o, 'precision'))} x ${fracIn(actual.w, opt(o, 'precision'))} in`;
      const main = nominal + (stockLenMM ? ` x ${ftText(stockLenMM)}` : '');
      return `${main} (${opt(o, 'dual') ? acts + ' · ' + metr : acts})`;
    }
    return `${metr} (${nominal})`;
  }

  /* ---- mass & loads ---- */
  function fmtWeight(kg, o) {
    const lb = trim0((kg * KG_LB).toFixed(1)) + ' lb';
    const met = trim0(String(r(kg, 1))) + ' kg';
    return opt(o, 'system') === 'imperial' ? dualize(lb, met, o) : dualize(met, lb, o);
  }
  function fmtPointLoad(kg, o) {
    const lb = Math.round(kg * KG_LB) + ' lb';
    const met = trim0(String(r(kg, 1))) + ' kg';
    return opt(o, 'system') === 'imperial' ? dualize(lb, met, o) : dualize(met, lb, o);
  }
  function fmtLinearLoad(kgPerM, o) {
    const lbft = Math.round(kgPerM * KGM_LBFT) + ' lb/ft';
    const met = trim0(String(r(kgPerM, 1))) + ' kg/m';
    return opt(o, 'system') === 'imperial' ? dualize(lbft, met, o) : dualize(met, lbft, o);
  }

  /* ---- trade & derived units ---- */
  function fmtBoardFeet(bdft, o) {
    const main = trim0(String(r(bdft, 1))) + ' bd ft';
    // board feet is the trade unit in BOTH systems; metric adds m³ secondary
    return opt(o, 'system') === 'metric' ? `${main} (${(bdft * M3_PER_BDFT).toFixed(2)} m³)` : main;
  }
  const fmtDeg = deg => trim0(String(r(deg, 1))) + '°';

  /* Sag/deflection limits expressed as a rate ("1 mm per 300 mm of span"
   * metric, "0.04 in/ft" imperial — same L/ratio limit, display-side only). */
  function fmtSagRate(limitRatio, o) {
    return opt(o, 'system') === 'imperial'
      ? trim0((12 / limitRatio).toFixed(2)) + ' in/ft'
      : `1 mm per ${limitRatio} mm of span`;
  }

  /* Knowledge-base strings carry lengths as {N} (or {N|s} fine / {N|ft}
   * board-length) tokens so static data still renders through the boundary. */
  function fmtTemplate(str, o) {
    return String(str).replace(/\{(\d+(?:\.\d+)?)(?:\|(s|ft))?\}/g, (m, num, kind) => {
      const v = parseFloat(num);
      if (kind === 's') return fmtSmall(v, o);
      if (kind === 'ft') return fmtBoardLength(v, o);
      return fmtLength(v, o);
    });
  }

  /* ---- inspector slider domains ----
   * Imperial sliders step in exact 1/16 in ticks (integer tick values, so no
   * float-step artifacts); metric sliders step 1 mm. toMM converts a slider
   * value back to millimetres exactly once, rounded to 0.1 mm — the same
   * precision the spec stores — so edits round-trip without drift. */
  function sliderDomain(minMM, maxMM, valueMM, o) {
    if (opt(o, 'system') === 'imperial') {
      const tick = IN / 16;
      return {
        min: Math.ceil(minMM / tick),
        max: Math.floor(maxMM / tick),
        value: Math.round(valueMM / tick),
        step: 1,
        toMM: v => Math.round(v * tick * 10) / 10
      };
    }
    return { min: Math.ceil(minMM), max: Math.floor(maxMM), value: Math.round(valueMM), step: 1, toMM: v => v };
  }

  /* ---- forgiving length input ----
   * One shared parser: accepts 29 1/2 · 29.5" · 2' 5" · 750mm · 75cm · 0.75m
   * · 48 in · 8 ft, in any display mode, and normalizes to millimetres.
   * A bare decimal with no unit falls back to `defaultUnit` (or the current
   * display system). Returns mm (number) or null. */
  const UNIT_MM = { mm: 1, millimeter: 1, millimeters: 1, millimetre: 1, millimetres: 1, cm: 10, centimeter: 10, centimeters: 10, m: 1000, meter: 1000, meters: 1000, metre: 1000, metres: 1000, in: IN, inch: IN, inches: IN, '"': IN, '″': IN, ft: FT, feet: FT, foot: FT, "'": FT, '′': FT };
  const FRACTION = String.raw`(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)`;

  function parseLength(input, defaultUnit) {
    const s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return null;
    const dflt = defaultUnit || (prefs.system === 'imperial' ? 'in' : 'mm');
    let m;

    // feet + optional inches: 2' 5", 2 ft 5 1/2 in, 6', 8 ft
    // (fraction alternative FIRST so 5 1/2 isn't split into 5 + stray 1/2)
    m = s.match(new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*(?:'|′|ft\.?|feet|foot)\s*(?:(?:${FRACTION}|(\d+(?:\.\d+)?))\s*(?:"|″|in\.?|inch(?:es)?)?)?$`));
    if (m) {
      let inches = 0;
      if (m[3] !== undefined) inches = (m[2] ? parseInt(m[2], 10) : 0) + parseInt(m[3], 10) / parseInt(m[4], 10);
      else if (m[5] !== undefined) inches = parseFloat(m[5]);
      return r(parseFloat(m[1]) * FT + inches * IN, 1);
    }
    // mixed / plain fraction, optionally marked as inches: 29 1/2, 3/4"
    m = s.match(new RegExp(String.raw`^${FRACTION}\s*(?:"|″|in\.?|inch(?:es)?)?$`));
    if (m) {
      const val = (m[1] ? parseInt(m[1], 10) : 0) + parseInt(m[2], 10) / parseInt(m[3], 10);
      return r(val * IN, 1); // a fraction is an inch idiom in any mode
    }
    // decimal + unit: 750mm, 75cm, 0.75m, 29.5", 48 in
    m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch(?:es)?|"|″|ft|feet|foot|'|′)\.?$/);
    if (m) return r(parseFloat(m[1]) * UNIT_MM[m[2]], 1);
    // bare decimal: current display system decides
    m = s.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return r(parseFloat(m[1]) * (UNIT_MM[dflt] || 1), 1);
    return null;
  }

  /* Rewrite every dimension token in free text to explicit millimetres, so
   * the AI (and the offline parser) NEVER convert units themselves. Applied
   * to chat input before anything reaches a model. Bare numbers are left
   * alone unless they sit next to a dimension word (then the current display
   * system supplies the unit). */
  const DIM_WORDS = 'wide|width|deep|depth|tall|height|high|long|thick|thickness';
  function normalizeLengthText(text) {
    let out = String(text == null ? '' : text);
    const mm = v => trim0(String(r(v, 1))) + 'mm';

    // Word numbers with an EXPLICIT length unit become digits first, so
    // "four feet wide" normalizes like "4 feet wide". Only feet/inches
    // spellings that are unambiguous — never bare "in", which is usually a
    // preposition ("two in the corner").
    const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    out = out.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(feet|foot|ft\.?|inches|inch)\b/gi,
      (m0, w, unit) => WORD_NUM[w.toLowerCase()] + ' ' + unit);

    // 2' 5", 2ft 5 1/2 in, 6 ft. In running text the inches part must be a
    // fraction or carry an inch marker — "6 ft 4 drawers" keeps its 4.
    out = out.replace(
      new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:'|′|ft\.?|feet|foot)\b(?:\s*(?:${FRACTION}\s*(?:"|″|in\b\.?|inch(?:es)?)?|(\d+(?:\.\d+)?)\s*(?:"|″|in\b\.?|inch(?:es)?)))?`, 'gi'),
      (m0, ft, w, n, d, dec) => {
        let inches = 0;
        if (n !== undefined) inches = (w ? parseInt(w, 10) : 0) + parseInt(n, 10) / parseInt(d, 10);
        else if (dec !== undefined) inches = parseFloat(dec);
        return mm(parseFloat(ft) * FT + inches * IN);
      });
    // 29 1/2 (in|"|bare), 3/4" — a fraction is an inch idiom. Whitespace is
    // only consumed together with a unit marker so "29 1/2 wide" keeps its space.
    out = out.replace(
      new RegExp(String.raw`(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)(?:\s*(?:"|″|in\b\.?|inch(?:es)?))?`, 'gi'),
      (m0, w, n, d) => {
        // leave pure "N/D" without unit AND without leading whole number alone
        // — "1/2 the size" must not become 12.7mm
        if (w === undefined && !/["″]|in\b|inch/i.test(m0)) return m0;
        return mm(((w ? parseInt(w, 10) : 0) + parseInt(n, 10) / parseInt(d, 10)) * IN);
      });
    // decimal + explicit unit: 29.5", 48 in, 75cm, 0.75m, 750mm
    out = out.replace(/(\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch(?:es)?|"|″)\b\.?/gi,
      (m0, num, unit) => mm(parseFloat(num) * UNIT_MM[unit.toLowerCase()]));
    out = out.replace(/(\d+(?:\.\d+)?)\s*(["″])/g, (m0, num) => mm(parseFloat(num) * IN));
    // bare number next to a dimension word: current system supplies the unit
    if (prefs.system === 'imperial') {
      out = out.replace(new RegExp(String.raw`(\d+(?:\.\d+)?)(\s+(?:${DIM_WORDS})\b)`, 'gi'),
        (m0, num, tail) => mm(parseFloat(num) * IN) + tail);
      // (?![\d.]…) also stops a partial-number match: "749.3mm" must not
      // backtrack to "749" + ".3mm" and get converted twice.
      out = out.replace(new RegExp(String.raw`\b((?:${DIM_WORDS})\s*(?:to|of|=|at)?\s+)(\d+(?:\.\d+)?)(?![\d.]|\s*(?:mm|cm|m\b|%))`, 'gi'),
        (m0, head, num) => head + mm(parseFloat(num) * IN));
    }
    return out;
  }

  BB.Units = {
    DEFAULTS, get, set, setSystem,
    fmtLength, fmtSmall, fmtDrill, fmtBoardLength, fmtSheet, fmtNominal,
    fmtWeight, fmtPointLoad, fmtLinearLoad, fmtBoardFeet, fmtDeg,
    fmtSagRate, fmtTemplate, sliderDomain,
    parseLength, normalizeLengthText,
    IN, FT
  };
})();
