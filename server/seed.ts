import { db } from "./db";

const users = [
    { name: "deib", pin: "2007" },
    { name: "papá", pin: "2606" },
    { name: "mamá", pin: "1974" }
];

const insert = db.query(
    "INSERT OR IGNORE INTO users (name, pin_hash) VALUES (?, ?)"
);

for (const u of users) {
    const hash = await Bun.password.hash(u.pin);
    insert.run(u.name, hash);
}

console.log(db.query("SELECT id, name FROM users").all());