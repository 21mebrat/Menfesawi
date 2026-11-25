# Private bookmarks

Use the authenticated server functions in `src/lib/server/bookmarks/service.ts` with a Payload request established by the server. The persisted account must be active. Every lookup and mutation is scoped to its owner, including for editors and admins. Each returned bookmark contains its ID, private plain-text note, creation timestamp, target collection, availability, and a small public content summary. Render notes as text. A note accepts up to 2,000 UTF-16 code units.

## HTTP operations

Use the existing website session or Payload JWT. Bookmark responses use `Cache-Control: private, no-store`. Browser writes must be same-origin. Send JSON for POST and PATCH.

| Method | Path | Input |
| --- | --- | --- |
| POST | `/api/bookmarks/mine` | `{"target":{"relationTo":"books","value":"<book ID>"},"note":"optional"}` |
| GET | `/api/bookmarks/mine` | Optional `targetType`, `page` starting at 1, `limit` from 1 to 100 (default 25), and Payload locale options |
| GET | `/api/bookmarks/mine/<bookmark ID>` | Fetch one owner-scoped summary |
| PATCH | `/api/bookmarks/mine/<bookmark ID>` | `{"note":"replacement"}` or `{"note":null}` |
| DELETE | `/api/bookmarks/mine/<bookmark ID>` | Returns HTTP 204 |

A repeated save for a publicly readable target returns the existing bookmark, including its original note and creation time. The first successful insert wins a race. Use PATCH to change the note. Page order is descending creation time, then descending bookmark ID. The list returns `docs`, `page`, and `hasNextPage`.

Public target resolution uses anonymous, depth-zero, live reads with the requested locale. Sections and passages must also be effectively published through their hierarchy. Unpublishing or deleting content keeps its bookmark and note. The response then has `status: "unavailable"` and `content: null`, without the target ID or title. Republishing the same record restores availability. The note remains editable and the bookmark removable throughout. Generic Payload CRUD is closed, including generic duplicate creates. GraphQL exposes no bookmark query or mutation. This keeps staff population and field projections away from raw polymorphic references.

## Indexes and lifecycle

The adapter stores the owner and target value as BSON ObjectIds and the target discriminator as a string. On connection, the application ensures these indexes on `bookmarks`.

| Name | Keys | Purpose |
| --- | --- | --- |
| `bookmark_identity` | `user: 1, target.relationTo: 1, target.value: 1` | Enforce uniqueness across workers |
| `bookmark_newest` | `user: 1, createdAt: -1, _id: -1` | Serve each owner's stable newest-first list |

If an installation already has a collection of this name, inspect its indexes and count duplicate triples before starting the new version. A conflicting index or duplicate prevents index creation. Resolve conflicts with the database owner before enabling writes. This implementation does not drop indexes, deduplicate records, or backfill data.

Operations use the project's transaction-enabled MongoDB connection. Account deletion retains its existing authorization and retention checks. A successful account deletion removes only that account's personal bookmarks in the same transaction. A refused or rolled-back deletion retains them. Target collections have no bookmark deletion hooks.
