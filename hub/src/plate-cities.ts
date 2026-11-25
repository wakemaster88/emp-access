/**
 * Unterscheidungszeichen deutscher Kennzeichen (Kreise und kreisfreie Städte,
 * inkl. wieder eingeführter Altkennzeichen). Reine Daten, keine Logik.
 *
 * Bis 20.11.2026 kannte der Hub nur ~35 Ruhrgebiets-Kreise. Kennzeichen aus
 * der Region (WAF, BE, GT, PB, LIP, MS …) wurden deshalb trotz sicherer Lesung
 * (0,95+) verworfen, und das Fahrzeug landete als „ohne Kennzeichen“ in der
 * Cloud. Zeichen mit Umlaut stehen nicht in ALL: Die OCR liefert nur A–Z.
 * Kreise mit Umlaut stehen in UMLAUT_CITY_BY_PLAIN (unten).
 *
 * Schalten (Tor/Shelly) hängt NICHT an dieser Liste, nur am exakten
 * Whitelist-Treffer (plate-match.ts). Die Cloud führt eine Kopie von ALL
 * (src/lib/plate-cities.ts); src/lib/plate-match.test.ts prüft, dass beide
 * gleich sind.
 */
const ALL = `
A AA AB ABG ABI AC AE AH AIB AIC AK ALF ALZ AM AN ANA ANG ANK AP APD ARN ART AS
ASL ASZ AT AU AUR AW AZ AZE
B BA BAD BAR BB BBG BBL BC BCH BD BE BED BER BF BGD BGL BH BI BID BIN BIR BIT
BIW BK BKS BL BLB BLK BM BN BNA BO BOG BOH BOR BOT BP BRA BRB BRG BRK BRL BRV
BS BSB BSK BT BTF BUL BW BWL BYL BZ
C CA CAS CB CE CHA CLP CLZ CO COC COE CUX CW
D DA DAH DAN DAU DBR DD DE DEG DEL DGF DH DI DIL DIN DIZ DKB DL DLG DM DN DO
DON DU DUD DW DZ
E EA EB EBE EBN EBS ECK ED EE EF EG EH EI EIC EIL EIN EIS EL EM EMD EMS EN ER
ERB ERH ERK ERZ ES ESB ESW EU EW
F FB FD FDB FDS FEU FF FFB FG FI FKB FL FN FO FOR FR FRG FRI FRW FS FT FTL FW FZ
G GA GAN GAP GC GD GDB GE GEL GEO GER GF GG GHA GHC GI GK GL GLA GM GMN GN GNT
GOA GOH GP GR GRA GRH GRI GRM GRZ GS GT GTH GUB GUN GV GVM GW GZ
H HA HAB HAL HAM HAS HB HBN HBS HC HCH HD HDH HDL HE HEB HEF HEI HEL HER HET HF
HG HGN HGW HH HHM HI HIG HIP HK HL HM HN HO HOG HOH HOL HOM HOR HOT HP HR HRO HS
HSK HST HU HV HVL HWI HX HY HZ
IGB IK IL ILL IN IZ
J JE JL
K KA KB KC KE KEH KEL KEM KF KG KH KI KIB KK KL KLE KLZ KM KN KO KR KRU KS KT KU
KUS KY KYF
L LA LAU LB LBS LBZ LD LDK LDS LEO LER LEV LF LG LH LI LIB LIF LIP LL LM LOS LP
LR LRO LSA LSN LSZ LU LUP LWL
M MA MAB MAI MAK MAL MB MC MD ME MED MEG MEI MEK MEL MER MET MG MGH MGN MH MHL
MI MIL MK MKK ML MM MN MO MOD MOL MON MOS MQ MR MS MSE MSH MSP MST MTK MTL MVL
MW MY MYK MZ MZG
N NAB NAI NAU NB ND NDH NE NEA NEB NEC NEN NES NEW NF NH NI NK NL NM NMB NMS NOH
NOL NOM NOR NP NR NT NU NVP NW NWM NY NZ
OA OAL OB OBG OC OCH OD OE OF OG OH OHA OHV OHZ OK OL OP OPR OS OSL OVI OVL OVP
OZ
P PA PAF PAN PAR PB PCH PE PEG PF PI PIR PL PM PN PR PS PW PZ
QFT QLB
R RA RC RD RDG RE REG REH REI RG RH RI RID RIE RL RM RN RO ROD ROF ROK ROL ROS
ROT ROW RP RPL RS RSL RT RU RV RW RZ
S SAB SAD SAN SAW SB SBG SBK SC SCZ SDH SDL SDT SE SEB SEE SEF SEL SFB SFT SG
SGH SH SHA SHG SHK SHL SI SIG SIM SK SL SLE SLF SLK SLN SLS SLZ SM SN SO SOB SOG
SOK SON SP SPB SPN SR SRB SRO ST STA STB STD STE STL SU SUL SW SWA SZ SZB
TBB TDO TE TET TF TG TIR TO TP TR TS TUT
UE UEM UFF UH UL UM UN
V VAI VB VEC VER VIE VIT VK VS
W WAF WAK WAN WAR WAT WB WBS WDA WE WEL WEN WER WES WF WHV WI WIL WIS WIT WIZ WK
WL WLG WM WMS WN WND WO WOB WOH WOL WOR WOS WR WRN WS WSF WST WSW WT WTL WTM
WUG WUN WUR WW WZ
Z ZE ZEL ZI ZIG ZP ZR ZW ZZ
`;

export const GERMAN_CITY_CODES: ReadonlySet<string> = new Set(ALL.split(/\s+/).filter(Boolean));

/**
 * Kreise mit Umlaut in der Schreibweise, in der die OCR sie liefert (Ä zu A,
 * Ö zu O, Ü zu U): LÜD wird als LUD gelesen. Nur Kreise, deren Schreibweise
 * ohne Umlaut kein eigener Kreis in ALL ist – BO bleibt Bochum. Eine Lesung
 * mit einem dieser Kreise gilt als bekannter Kreis und erscheint mit Umlaut
 * (plate-match.ts, umlautReading), wenn sich ihre Zeichen nicht auch als
 * Kennzeichen eines anderen Kreises lesen lassen.
 */
export const UMLAUT_CITY_BY_PLAIN: ReadonlyMap<string, string> = new Map([
  ["BUR", "BÜR"],
  ["BUS", "BÜS"],
  ["BUZ", "BÜZ"],
  ["DUW", "DÜW"],
  ["FU", "FÜ"],
  ["FUS", "FÜS"],
  ["GO", "GÖ"],
  ["GU", "GÜ"],
  ["HOS", "HÖS"],
  ["HOX", "HÖX"],
  ["JUL", "JÜL"],
  ["KON", "KÖN"],
  ["KOT", "KÖT"],
  ["KOZ", "KÖZ"],
  ["KUN", "KÜN"],
  ["LO", "LÖ"],
  ["LOB", "LÖB"],
  ["LUD", "LÜD"],
  ["LUN", "LÜN"],
  ["MU", "MÜ"],
  ["MUB", "MÜB"],
  ["MUR", "MÜR"],
  ["NO", "NÖ"],
  ["RUG", "RÜG"],
  ["SOM", "SÖM"],
  ["SUW", "SÜW"],
  ["TOL", "TÖL"],
  ["TU", "TÜ"],
  ["WU", "WÜ"],
  ["WUM", "WÜM"],
]);

/**
 * Kreise rund um den Standort (Beckum, Kreis Warendorf). Nur Tie-Break, wenn
 * ein kompakter OCR-Text zwei gültige Aufteilungen hat (GTK3434E → GT-K oder
 * G-TK): Die Aufteilung mit dem Kreis aus der Region gewinnt.
 */
export const LOCAL_CITY_CODES: ReadonlySet<string> = new Set([
  "WAF", "BE", "GT", "HAM", "MS", "SO", "PB", "BI", "LIP", "UN", "COE", "ST",
  "LP", "WAR", "DO", "HF", "HSK", "MK", "BOR", "RE", "AH", "BOT",
]);
