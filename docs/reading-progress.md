# Private reading progress

Each active account has one optional resume position per structured publication. A position identifies a section and optionally one of its direct passages. Omitting the passage resumes at the section start. Readers can intentionally move backward.

## Saving and resetting

Read the current position before editing. An absent record returns JSON `null`. Use `expectedRevision: 0` to create it. The first successful save returns revision 1 and a server-generated progress `id`. Use that ID as the **generation** on subsequent saves. Every successful update increments the revision, including a save of the same position.

| Method | Path | Input |
| --- | --- | --- |
| GET | `/api/reading-progress/mine/<publication ID>` | Optional Payload locale and fallback locale |
| PUT | `/api/reading-progress/mine/<publication ID>` | JSON with `section`, optional `passage`, and `expectedRevision`. Existing records also require `generation`. |
| GET | `/api/reading-progress/mine` | Optional `page` from 1 and `limit` from 1 to 100 (default 25), plus locale options |
| DELETE | `/api/reading-progress/mine/<progress ID>` | JSON with `expectedRevision`. The URL carries the generation. Success returns HTTP 204. |

For example, the first PUT can send `{"section":"<section ID>","expectedRevision":0}`. To resume at a passage afterward, send `{"section":"<section ID>","passage":"<passage ID>","expectedRevision":1,"generation":"<returned progress ID>"}`.

Missing or stale revision/generation preconditions produce HTTP 409. On conflict, refetch and let the reader decide whether to apply the change. **After reset, discard the old revision and ID and refetch before saving.** Recreating the row assigns a new ID, so revision 1 of a replacement cannot be overwritten or removed using the old generation. A reader at the largest safe integer revision may reset the row.

The server functions in `src/lib/server/reading-progress/service.ts` take the authenticated Payload request in their options. For a list row, call `resetMyReadingProgress(null, {generation: row.id, expectedRevision: row.revision}, {req})`. A known publication ID can be supplied instead of null as an additional constraint.

## Privacy and lifecycle

The server derives ownership from the active website session, rechecks the persisted account, and filters every progress lookup by owner. Staff use their own positions. Generic Payload CRUD and GraphQL access are disabled. The authenticated routes send `Cache-Control: private, no-store` and require same-origin browser writes.

Navigation summaries come from live anonymous reads in a single database transaction. On each read, the service verifies effective visibility and current section/publication and passage/section membership. A missing, hidden or moved target yields only the progress ID, revision, update time and `unavailable` status. The position remains stored and can be reset or replaced. A later read can resume it again if the original position becomes valid. Lists sort by descending update time and then descending progress ID. Target content changes leave the reader's revision untouched.

Account deletion uses the existing retention checks and account write lock. Committed account deletion removes that account's personal progress in the same transaction. Rolling back the deletion retains it.

## MongoDB preflight

The existing transaction-enabled MongoDB connection ensures two native indexes on the collection used by the `reading-progress` model. The unique identity index has keys `{user: 1, publication: 1}`. The listing index has keys `{user: 1, updatedAt: -1, _id: -1}`. Owner and content IDs are BSON ObjectIds.

Before rollout to an installation with existing data at that collection name, inspect its actual indexes and run a read-only duplicate check, using the model's physical collection name. The installed adapter used `reading-progresses` in the isolated database.

```js
const collectionName = 'reading-progresses'
db.getCollection(collectionName).getIndexes()
db.getCollection(collectionName).aggregate([
  { $group: { _id: { user: '$user', publication: '$publication' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: 'duplicatePairs' }
])
```

Check existing rows for missing or malformed required IDs, timestamps and revisions. Conflicting indexes or duplicate identities require an approved repair before enabling writes. No migration, deduplication, or index replacement is included.
