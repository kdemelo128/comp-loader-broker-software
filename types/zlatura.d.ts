/* zlatura.d.ts -- the units a number can be in, and the deal as data.
 *
 * Types for the checker only (tsc --checkJs, run by npm test): the browser
 * never loads this file, and nothing in app/ changes at run time.
 *
 * A unit is a "flavor": a plain number is accepted anywhere, so ordinary
 * arithmetic needs no annotation, but a number known to be in one unit is
 * refused where another is expected. A rent per SF a month can't be passed
 * as a rent per SF a year, a fraction can't be shown as a percent, months
 * can't be used as years. Crossing units goes through a named conversion
 * (monthlyAmount, pc / the workbook's percent, dayOf / isoOf, serial...). */

type Flavor<U extends string> = number & { readonly __unit?: U };

/* ---------------------------------------------------------------- money */
/** Dollars at one time: a price, a loan, a balance, equity, a TI total. */
type Usd = Flavor<'USD'>;
/** Dollars a year: NOI, gross income, expenses, taxes, GPR, debt service, annual rent. */
type UsdPerYear = Flavor<'USD/yr'>;
/** Dollars a month: monthly rent, a loan payment. */
type UsdPerMonth = Flavor<'USD/mo'>;
/** A rent per SF a year (lease rates, market rent, reserves, NOI or expenses per SF). */
type UsdPerSfYear = Flavor<'USD/SF/yr'>;
/** A rent per SF a month. */
type UsdPerSfMonth = Flavor<'USD/SF/mo'>;
/** A price per SF of building: no time in it. */
type UsdPerSf = Flavor<'USD/SF'>;
/** A price per SF of land. */
type UsdPerLandSf = Flavor<'USD/land SF'>;
/** Dollars per apartment or unit. */
type UsdPerUnit = Flavor<'USD/unit'>;
/** A month's rent per unit (multifamily market rent). */
type UsdPerUnitMonth = Flavor<'USD/unit/mo'>;
/** A rent as quoted on a lease period or a market rent: dollars in its own `unit`; only monthlyAmount() turns it into dollars. */
type RentRate = Flavor<'rent, in its unit'>;
/** A rent in the unit its `unit` tag names: as quoted, or already in one of the rent units. Only monthlyAmount() turns it into dollars a month. */
type RentInUnit = RentRate | UsdPerMonth | UsdPerYear | UsdPerSfYear | UsdPerSfMonth | UsdPerUnitMonth;
/** How a rent is quoted. */
type RentUnit = 'year' | 'month' | 'psf_year' | 'psf_month';

/* ------------------------------------------------------------- percents */
/** A percent: 6.25 means 6.25% (cap rates, LTV, interest, occupancy, growth). */
type Pct = Flavor<'%'>;
/** A share as Excel takes it: 0.0625. */
type Fraction = Flavor<'fraction'>;
/** A relative change, as a percent: rents +3%, priced 12% above the comps. */
type PctChange = Flavor<'% change'>;
/** The difference of two percents: 0.15 points apart. */
type Points = Flavor<'points'>;
/** Basis points: a 100 bp shock. */
type Bps = Flavor<'bp'>;

/* ----------------------------------------------------------- area, time */
/** Building or rentable area as the deal states it (not split into GBA / RSF / USF yet). */
type Sf = Flavor<'SF'>;
/** Land area in SF. */
type LandSf = Flavor<'land SF'>;
type Acres = Flavor<'acres'>;
type Years = Flavor<'years'>;
type Months = Flavor<'months'>;
/** A date as text, YYYY-MM-DD. */
type IsoDate = string & { readonly __unit?: 'ISO date' };
/** Whole UTC days since 1970-01-01, as the engine counts them. */
type DayNumber = Flavor<'day'>;
/** Excel's date number. */
type ExcelSerial = Flavor<'Excel serial'>;
/** A ratio shown as "x": DSCR, equity multiple, price over gross income. */
type Multiple = Flavor<'x'>;

/* --------------------------------------------------------------- the deal */
interface Figures {
  price?: Usd; noi?: UsdPerYear; cap?: Pct; occ?: Pct; noi_pf?: UsdPerYear; cap_pf?: Pct;
  price_psf?: UsdPerSf; price_unit?: UsdPerUnit;
  address?: string; city?: string; state?: string; zip?: string; ptype?: string;
  bsf?: Sf; lot_sf?: LandSf; units?: number; year?: number; renovated?: number; stories?: number; zoning?: string; parking?: string;
  gpr?: UsdPerYear; gross?: UsdPerYear; opex?: UsdPerYear; taxes?: UsdPerYear;
  tenant?: string; guarantor?: string; lease_type?: string; lease_exp?: string; term_left?: string; increases?: string; options?: string;
  rentRoll?: OmRentRow[];
}
interface Loan { ltv?: Pct; rate?: Pct; amort?: Years; io?: boolean; closing?: Pct; minDscr?: Multiple; minDy?: Pct }
/** A row of the OM's rent roll table (and what the analysis reads of a rent roll). */
interface OmRentRow { suite?: string; tenant?: string; sf?: Sf; annual?: UsdPerYear; psf?: UsdPerSfYear; start?: string; end?: string; vacant?: boolean; mtm?: boolean }
interface RentPeriod { start: IsoDate; end: IsoDate; rate: RentInUnit; unit: RentUnit; source?: string; note?: string; edited?: boolean }
interface Abatement { start: IsoDate; end: IsoDate; pct: Pct; source?: string; note?: string }
interface Recovery { method: 'none' | 'prorata' | 'base_year' | 'stop' | 'fixed'; share?: Pct; baseAmount?: UsdPerYear; stopPsf?: UsdPerSfYear; amount?: UsdPerYear; growth?: Pct }
interface Renewal {
  assume?: boolean; probability?: Pct; termMonths?: Months; downtime?: Months; renewFree?: Months; newFree?: Months;
  renewTi?: UsdPerSf; newTi?: UsdPerSf; renewLc?: Pct; newLc?: Pct; escalation?: Pct;
}
interface Lease {
  id: string; unit?: string; tenant?: string; unitType?: string; sf?: Sf; vacant?: boolean; mtm?: boolean; status?: string;
  leaseStart?: IsoDate; rentStart?: IsoDate; leaseEnd?: IsoDate; periods: RentPeriod[]; abatements: Abatement[];
  marketRent?: RentInUnit; marketUnit?: RentUnit; recovery?: Recovery;
  percentRent?: { rate: Pct; sales: UsdPerYear; breakpoint?: UsdPerYear; natural?: boolean; growth?: Pct };
  oneTime?: { date: IsoDate; amount: Usd; label?: string }[]; renewal?: Renewal; leaseUpMonths?: Months;
  deposit?: Usd; arrears?: Usd; options?: string; notes?: string; custom?: Record<string, unknown>; source?: { kind: string; page?: number; file?: string };
}
interface RentRollSettings {
  asOf: IsoDate | null; years?: Years; marketRent?: RentInUnit | null; marketUnit?: RentUnit; marketGrowth?: Pct; opex?: UsdPerYear | null; expenseGrowth?: Pct;
  recoverable?: UsdPerYear | null; generalVacancy?: Pct; reservesPsf?: UsdPerSfYear; otherIncome?: { label?: string; annual: UsdPerYear; growth?: Pct }[];
  leaseUpMonths?: Months; buildingSf?: Sf | null; renewal?: Renewal;
}
interface RentRoll { settings: RentRollSettings; leases: Lease[]; columns?: unknown[] | null }
/** What a scenario sets for itself (deal.live, and each saved scenario's `over`). */
interface ScenarioOver {
  price?: Usd; noi?: UsdPerYear; occ?: Pct; rentChange?: PctChange; expenseChange?: PctChange;
  ltv?: Pct; rate?: Pct; amort?: Years; io?: boolean; closing?: Pct; hold?: Years; growth?: Pct; saleCost?: Pct; exitCap?: Pct; noiBasis?: 'rentroll';
}
interface Deal {
  id: string; name?: string; figures: Figures; loan: Loan; rr?: RentRoll | null; rentRoll?: OmRentRow[];
  live?: ScenarioOver; scenarios?: { id: string; name: string; at?: number; over: ScenarioOver }[];
  targets?: { cap?: Pct | null; irr?: Pct | null; value?: Pct | null };
  sources?: Record<string, { hand?: boolean; page?: number; ai?: boolean; orig?: unknown; line?: string; verified?: boolean }>;
  [other: string]: unknown;
}

/* ------------------------------------------------- what analyze() gives */
interface Analysis {
  derived: { price?: boolean; noi?: boolean }; checks: { level: string; text: string }[]; questions: string[];
  price: Usd | null; noi: UsdPerYear | null; capCalc: Pct | null; cap: Pct | null;
  ppsf: UsdPerSf | null; perUnit: UsdPerUnit | null; perLandSf: UsdPerLandSf | null; noiPsf: UsdPerSfYear | null;
  grossMultiple: Multiple | null; expenseRatio: Pct | null; opexPsf: UsdPerSfYear | null; taxPsf: UsdPerSfYear | null;
  age: Years | null; leases: LeaseStats | null; termLeft: Years | null; occ: Pct | null; occSource: string | null;
  loan: Usd | null; debtService: UsdPerYear | null; dscr: Multiple | null; debtYield: Pct | null; cashFlow: UsdPerYear | null;
  closing: Usd; equity: Usd | null; cashOnCash: Pct | null; breakEven: Pct | null; breakEvenBasis: string | null;
  maxLoan: { loan: Usd; binding: string; tests: Record<string, Usd> } | null;
  ladder: { cap: Pct; value: Usd; ppsf: UsdPerSf | null; vsAsk: PctChange | null }[];
  vsWeighted?: PctChange | null; vsMedian?: PctChange | null; percentile?: Pct | null; valueAtWeighted?: Usd | null; valueAtMedianCap?: Usd | null; thinCaps?: boolean;
}
interface LeaseStats {
  tenants: number; rent: UsdPerYear; totalSf: Sf | null; leasedSf: Sf | null; vacantSf: Sf; occupancy: Pct | null;
  waltIncome: Years | null; waltSf: Years | null; walt: Years | null; waltWeight: string; waltMtm: string;
  avgRentPsf: UsdPerSfYear | null; roll12Pct: Pct | null; roll24Pct: Pct | null; undatedRent: UsdPerYear;
}

/* ------------------------------------------- what the browser gives us */
// libraries the app loads when needed, and the Claude artifact host
interface Window { fflate: any; ExcelJS: any; pdfjsLib: any; claude?: any; requestIdleCallback?: any; __zlaturaReady?: boolean; launchQueue?: any }
interface Navigator { standalone?: boolean }
interface Error { code?: string }
// the app reads form fields and data attributes through event targets and query results
interface EventTarget { classList?: DOMTokenList; value?: any; files?: any; checked?: any; closest?: any; tagName?: string; id?: string; isContentEditable?: boolean; dataset?: DOMStringMap; matches?: any }
interface Element { dataset: DOMStringMap; focus(options?: FocusOptions): void; blur(): void; value?: any; selectionStart?: number; selectionEnd?: number; select?(): void; media?: string; disabled?: boolean; hidden?: boolean; style: CSSStyleDeclaration; click(): void }
interface HTMLElement { open?: boolean; value?: any; disabled?: boolean; setSelectionRange?: any; checked?: any; files?: any; type?: string }
interface Event { detail?: any }

/* ---------------------------------- what the analysis and scenarios take */
/** What analyze() reads of a deal (impact.js analysisInput). */
type AnalysisInput = Figures & { rentRoll?: OmRentRow[]; loan?: Loan; rentRollAsOf?: IsoDate | null };
/** A scenario's assumptions, worked through (deal.js scenarioBase, runScenario). */
interface ScenarioInputs {
  price: Usd | null; noi: UsdPerYear | null; occ: Pct | null; gross: UsdPerYear | null; opex: UsdPerYear | null;
  rentChange: PctChange; expenseChange: PctChange; ltv: Pct; rate: Pct; amort: Years; io: boolean; closing: Pct;
  hold: Years; growth: Pct; saleCost: Pct; exitCap: Pct | null; noiBasis?: 'rentroll'; grossNow?: UsdPerYear; opexNow?: UsdPerYear;
}
/** The loan terms hold-period returns take. */
interface HoldLoan { ltv?: Pct; rate?: Pct; amort?: Years; io?: boolean; closing?: Pct; minDscr?: Multiple; minDy?: Pct }
/** What scenarioAnswers() is asked. */
interface ScenarioTargets { targetCap?: Pct | null; targetIrr?: Pct | null; capForValue?: Pct | null }

/* --------------------------------------------------------- the projection */
/** One month of a projection (lease.js project()). Dollars are that month's. */
interface ProjectionMonth {
  month: IsoDate; base: UsdPerMonth; projected: UsdPerMonth; vacancy: UsdPerMonth; free: UsdPerMonth; recoveries: UsdPerMonth; pctRent: UsdPerMonth;
  other: UsdPerMonth; oneTime: UsdPerMonth; opex: UsdPerMonth; ti: UsdPerMonth; lc: UsdPerMonth; reserves: UsdPerMonth; occupiedSf: Sf;
  rent?: UsdPerMonth; gpr?: UsdPerMonth; generalVacancy?: UsdPerMonth; egi?: UsdPerMonth; noi?: UsdPerMonth; cashFlow?: UsdPerMonth; occupancy?: Pct | null;
}
/** One projected year: the months' dollars added up (a year's), occupancy averaged. */
interface ProjectionYear {
  year: number; from: IsoDate; to: IsoDate; base: UsdPerYear; projected: UsdPerYear; rent: UsdPerYear; vacancy: UsdPerYear; gpr: UsdPerYear;
  free: UsdPerYear; recoveries: UsdPerYear; pctRent: UsdPerYear; other: UsdPerYear; oneTime: UsdPerYear; generalVacancy: UsdPerYear;
  egi: UsdPerYear; opex: UsdPerYear; noi: UsdPerYear; ti: UsdPerYear; lc: UsdPerYear; reserves: UsdPerYear; cashFlow: UsdPerYear; occupancy: Pct | null;
}

/** Each registered figure's unit label (engine/figures.js), held to its type in Analysis above. */
interface AnalysisUnits {
  price: '$'; noi: '$/yr'; capCalc: '%'; cap: '%'; ppsf: '$/SF'; perUnit: '$/unit'; perLandSf: '$/land SF'; noiPsf: '$/SF/yr';
  grossMultiple: 'x'; expenseRatio: '%'; opexPsf: '$/SF/yr'; taxPsf: '$/SF/yr'; age: 'years'; leases: 'record'; termLeft: 'years';
  occ: '%'; occSource: 'text'; loan: '$'; debtService: '$/yr'; dscr: 'x'; debtYield: '%'; cashFlow: '$/yr'; closing: '$'; equity: '$';
  cashOnCash: '%'; breakEven: '%'; breakEvenBasis: 'text'; maxLoan: 'record'; ladder: 'table';
  vsWeighted: '% change'; vsMedian: '% change'; percentile: '%'; valueAtWeighted: '$'; valueAtMedianCap: '$'; thinCaps: 'flag'; derived: 'record';
}

/* ------------------------------------------------- what the formatters take */
/** Any dollar amount money0() and money2() may show. */
type AnyUsd = Usd | UsdPerYear | UsdPerMonth | UsdPerSfYear | UsdPerSfMonth | UsdPerSf | UsdPerLandSf | UsdPerUnit | UsdPerUnitMonth | RentRate;
/** What pct() and signed() may show: a percent, a change in percent, or points. Never a fraction. */
type AnyPct = Pct | PctChange | Points;
