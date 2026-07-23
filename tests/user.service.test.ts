import test from "node:test";
import assert from "node:assert/strict";
import { filterUsersForRole } from "../src/controllers/services/user.service";

const sampleUsers = [
  { id: 1, role: "super_admin" },
  { id: 2, role: "admin" },
  { id: 3, role: "csg_president" },
  { id: 4, role: "governor" },
  { id: 5, role: "cashier" },
];

test("admin role hides super_admin users from the visible list", () => {
  const visibleUsers = filterUsersForRole(sampleUsers, "admin");

  assert.deepEqual(
    visibleUsers.map((u) => u.role),
    ["admin", "csg_president", "governor", "cashier"],
  );
});

test("csg_president hides admin and super_admin users", () => {
  const visibleUsers = filterUsersForRole(sampleUsers, "csg_president");

  assert.deepEqual(
    visibleUsers.map((u) => u.role),
    ["csg_president", "governor", "cashier"],
  );
});

test("governor hides admin and super_admin users", () => {
  const visibleUsers = filterUsersForRole(sampleUsers, "governor");

  assert.deepEqual(
    visibleUsers.map((u) => u.role),
    ["csg_president", "governor", "cashier"],
  );
});

test("cashier hides admin and super_admin users", () => {
  const visibleUsers = filterUsersForRole(sampleUsers, "cashier");

  assert.deepEqual(
    visibleUsers.map((u) => u.role),
    ["csg_president", "governor", "cashier"],
  );
});

test("super_admin role still sees all users", () => {
  const visibleUsers = filterUsersForRole(sampleUsers, "super_admin");

  assert.deepEqual(visibleUsers, sampleUsers);
});
