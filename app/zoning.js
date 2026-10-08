/* zoning.js -- DC zoning max-FAR reference, carried over from the Zoning
 * Catalogue tab of the comps template this tool replaced. Codes outside the District are not
 * in this list; a comp zoned outside it is flagged and its buildable SF is
 * left blank rather than guessed. */
export const ZONING = [["MU-1",4.8],["MU-1/DC",4.8],["MU-2",7.2],["MU-2/CAP",2.16],["MU-2/DC",7.2],["MU-3",2.4],["MU-4",3],["MU-4/CAP",2.16],["MU-4/CAP/CHC",3],["MU-4/CHC",3],["MU-4/DC",3],["MU-4/NO",3],["MU-4/RC",3],["MU-5",4.2],["MU-5A/DC",4.2],["MU-5A/RC",4.2],["MU-6",7.2],["MU-6B/DC",7.2],["MU-7",4.8],["MU-7B/FT",4.8],["MU-8",6],["MU-8B/DC",6],["MU-9",7.8],["MU-9B/DC",7.8],["MU-10",7.2],["MU-10/DC",7.2],["MU-10/FT",6],["MU-11",0.5],["MU-12",3],["MU-13",4.8],["MU-14",7.2],["MU-15",4.8],["NMU-3A/MW",1],["NMU-4/CP",2.4],["NMU-4/GA",3],["NMU-4/H-A",3],["NMU-4/H-H",3],["NMU-4/H-R",3],["NMU-4/TK",3],["NMU-4/WP",3],["NMU-5A/H-H",4.2],["NMU-5A/H-R",4.2],["NMU-5A/WP",3.6],["NMU-6B/H-H",4.8],["NMU-7B/ES",3],["NMU-7B/GA",4.8],["NMU-7B/H-A",4.8],["NMU-7B/H-H",4.8],["NMU-8B/H-H",6],["D-1-R",2],["D-2",7.2],["D-3",9],["D-4",7.8],["D-4-R",4.5],["D-5",6.5],["D-5-R",6],["D-6",10],["D-6-R",10],["D-7",10],["D-8",6.5],["PDR-1",3.5],["PDR-1/CAP",3.5],["PDR-1/FT",3.5],["PDR-2",4.5],["PDR-3",6],["PDR-4",6],["PDR-4/FT",6],["BF-1",null],["BF-2",null],["CG-1",7.2],["CG-2",7.2],["CG-3",7.8],["CG-4",7.2],["CG-5",4.8],["CG-6",2.5],["CG-7",6],["HE-1",3],["HE-2",4.8],["HE-3",7.2],["HE-4",6],["ARTS-1",3],["ARTS-2",4.2],["ARTS-3",4.8],["ARTS-4",7.2],["NYE",8],["NHR",9],["SEFC-1",6],["SEFC-2",6],["SEFC-3",3.5],["SEFC-4",0.5],["StE-1",0.2],["StE-2",4],["StE-3",2.5],["StE-4",0.5],["StE-5",1.5],["StE-6",3.2],["StE-7",1.5],["StE-8",0.4],["StE-9",1.5],["StE-10",1.5],["StE-11",0.7],["StE-12",3],["StE-13",3.2],["StE-14",1.5],["StE-15",2],["StE-16",3.2],["StE-17",0.5],["StE-18",4],["StE-19",0],["USN",6.5],["WR-1",null],["WR-2",3.75],["WR-3",3.5],["WR-4",2],["WR-5",1],["WR-6",0],["WR-7",1.25],["WR-8",3.25],["WR-9",null],["WR-10",4.5],["WR-11",4.5],["WR-12",2],["WR-13",6],["WR-14",4.5],["WR-15",2.5],["R-1A",null],["R-1A/CBUT",null],["R-1A/FH",null],["R-1A/TS",null],["R-1A/TS/NO",null],["R-1A/WH",null],["R-1B",null],["R-1B/FH",null],["R-1B/GT",null],["R-1B/NO",null],["R-1B/SH",null],["R-1B/TS",null],["R-1B/WH",null],["R-2",null],["R-2/FH",null],["R-3",null],["R-3/FB",null],["R-3/GT",null],["R-3/NO",null],["RF-1",null],["RF-1/DC",null],["RF-1/CAP",null],["RF-4",1.8],["RF-5",1.8],["RA-1",0.9],["RA-1/NO",0.9],["RA-2",1.8],["RA-2/CAP",1.8],["RA-2/DC",1.8],["RA-2/RC",2.16],["RA-3",3],["RA-4",3.5],["RA-4/DC",3.5],["RA-5",6],["RA-5/DC",6],["MU-16",7.2],["MU-21",7.8]];

/* Montgomery County names its mixed-use and employment zones with their limits
 * built in: "CR-3.0 C-2.0 R-2.75 H-145" is a Commercial/Residential zone with a
 * maximum total FAR of 3.0, nonresidential 2.0, residential 2.75 and a height
 * of 145 ft. The number after the zone family is the maximum total FAR
 * (Montgomery County Zoning Ordinance, Article 59-2). Bethesda and Silver
 * Spring comps carry these codes, so their buildable SF can be computed rather
 * than left blank. A bare family name ("CRT") carries no number and stays
 * unknown. */
// The industrial zones (IL, IM, IH) carry their FAR the same way ("IL-1.0
// H-50"). CoStar sometimes drops the hyphen ("CR3.0") or spaces it ("CR 3.0").
// Residential zones such as R-60 or RT-12.5 name a lot size or a density, not
// a FAR, so they are deliberately not matched.
const MOCO = /^(CRN|CRT|CR|EOF|LSC|GR|NR|IL|IM|IH)[-\s]?(\d+(?:\.\d+)?)(?=[\s,]|$)/;

const norm = (code) => String(code || '').trim().toUpperCase();
const TABLE = new Map(ZONING.map(([code, far]) => [norm(code), far]));

/** Where a zoning code's max FAR comes from, or null when it is unknown. */
export function zoningInfo(code) {
  const k = norm(code);
  if (!k) return null;
  if (TABLE.has(k)) return { far: TABLE.get(k), source: 'catalogue' };
  const m = MOCO.exec(k);
  if (m) return { far: Number(m[2]), source: 'moco' };
  return null;
}

/** The lookup the comp rules use: max FAR, null for a known code with no FAR
 *  recorded, undefined for a code it does not recognise. Case-insensitive,
 *  as Excel's MATCH is. */
export function zoningLookup(code) {
  const info = zoningInfo(code);
  return info ? info.far : undefined;
}

export const MOCO_NOTE = 'Montgomery County: the number after the zone family is the maximum total FAR '
  + '(Zoning Ordinance, Article 59-2)';
