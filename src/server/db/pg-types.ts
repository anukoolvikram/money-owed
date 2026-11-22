import pg from "pg";

// Return Postgres DATE values as plain 'YYYY-MM-DD' strings. The default parser
// builds a JS Date at local midnight, which can shift the India date when the
// server runs in UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// int8/bigint stays a string by default; we convert explicitly with BigInt().

export { pg };
