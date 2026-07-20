import { db } from "./db";

const users = [
    { name: "hijo", pin: "2007" },
    { name: "papá", pin: "" },
    { name: "mamá", pin: "" }
];

const insert = db.query(
    "INSERT OR IGNORE INTO users (name, pin_hash) VALUES (?, ?)"
);

for (const u of users) {
    const hash = await Bun.password.hash(u.pin);
    insert.run(u.name, hash);
}

console.log(db.query("SELECT id, name FROM users").all());