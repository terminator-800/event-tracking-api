import test from "node:test";
import assert from "node:assert/strict";
import { filterUsersForRole } from "../src/controllers/services/user.service";

test("admin role hides super_admin users from the visible list", () => {
  const users = [
    { id: 1, role: "super_admin" },
    { id: 2, role: "admin" },
    { id: 3, role: "csg_president" },
  ];

  const visibleUsers = filterUsersForRole(users, "admin");

  assert.deepEqual(visibleUsers, [
    { id: 2, role: "admin" },
    { id: 3, role: "csg_president" },
  ]);
});

test("super_admin role still sees all users", () => {
  const users = [
    { id: 1, role: "super_admin" },
    { id: 2, role: "admin" },
  ];

  const visibleUsers = filterUsersForRole(users, "super_admin");

  assert.deepEqual(visibleUsers, users);
});
