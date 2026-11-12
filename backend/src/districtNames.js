// Shared by the server and the browser: maps the different district spellings used by the
// target sheet and the planting data to one key (e.g. "Tiiruchirappalli", "TRICHY" -> TIRUCHIRAPPALLI).
const DISTRICT_ALIASES = {
  TIIRUCHIRAPPALLI: "TIRUCHIRAPPALLI", TIRUCHIRAPALLI: "TIRUCHIRAPPALLI", TRICHY: "TIRUCHIRAPPALLI", TIRUCHY: "TIRUCHIRAPPALLI",
  THOOTHUKUDI: "TUTICORIN", THOOTHUKKUDI: "TUTICORIN",
  NILGIRIS: "THENILGIRIS",
  KANCHIPURAM: "KANCHEEPURAM",
  TIRUVARUR: "THIRUVARUR",
  VILUPPURAM: "VILLUPURAM",
  TIRUPATHUR: "TIRUPATTUR", THIRUPATHUR: "TIRUPATTUR",
  KALLAKURUCHI: "KALLAKURICHI",
  SIVAGANGAI: "SIVAGANGA",
  TIRUNELVELI: "THIRUNELVELI",
  TIRUVALLUR: "THIRUVALLUR",
  TIRUPUR: "TIRUPPUR",
  KANNIYAKUMARI: "KANYAKUMARI",
};

export function districtKey(value) {
  const key = String(value ?? "").toLocaleUpperCase("en").replace(/[^A-Z]/g, "");
  return DISTRICT_ALIASES[key] ?? key;
}
