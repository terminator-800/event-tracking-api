import http from "k6/http";
import { check, sleep } from "k6";

// Pool of test users
const users = [
  { username: "admin", password: "@Normi.2026" },
  { username: "gov-IT", password: "@Normi.2026" },
  { username: "gov-CEAS", password: "@Normi.2026" },
  { username: "gov-CBA", password: "@Normi.2026" },
  { username: "csg-president", password: "@Normi.2026" },
];

export const options = {
  vus: 200,
  duration: "30s",
};

export default function () {
  // Pick a random user each iteration
  const user = users[Math.floor(Math.random() * users.length)];

  const payload = JSON.stringify(user);

  const loginRes = http.post("http://localhost:5000/login", payload, {
    headers: { "Content-Type": "application/json" },
    redirects: 0,
  });

  const loginSuccess = check(loginRes, {
    "login succeeded": r => r.status === 200 && r.cookies.token !== undefined,
  });

  if (!loginSuccess) {
    console.error("Login failed", loginRes.status, loginRes.body);
    return;
  }

  const token = loginRes.cookies.token[0].value;

  const meRes = http.get("http://localhost:5000/me", {
    headers: { "Content-Type": "application/json", Cookie: `token=${token}` },
  });

  check(meRes, { "accessed /me": r => r.status === 200 });

  sleep(1);
}