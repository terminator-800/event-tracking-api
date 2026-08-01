# Dev-only attendance test routes (temporary)

Remove when manual/k6 testing is done:

1. Delete this entire `src/dev/` folder.
2. In `src/app.ts`, remove the `attendanceDevRoutes` import and `registerDevRoutes(app)` call.

Nothing else in the API depends on this folder.
