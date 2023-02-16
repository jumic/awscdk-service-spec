import { Database, emptyCollection, emptyIndex, Entity, EntityCollection, stringCmp } from '../src';

interface Thing extends Entity {
  readonly name: string;
  readonly value?: string;
}

let db: Database<{
  readonly thing: EntityCollection<Thing, 'name'>;
}>;

function emptyDatabase(): typeof db {
  return new Database({
    thing: emptyCollection({
      name: emptyIndex('name', stringCmp),
    }),
  });
}

beforeEach(() => {
  db = emptyDatabase();
});


describe.each([false, true])('database is filled with one item (saveAndLoad: %p)', (saveAndLoad) => {
  beforeEach(() => {
    db.allocate('thing', {
      name: 'A',
      value: 'A',
    });

    if (saveAndLoad) {
      const serialized = db.save();
      const fresh = emptyDatabase();
      fresh.load(serialized);
      db = fresh;
    }
  });

  test('it can be looked up', () => {
    // THEN
    expect(db.all('thing')).toContainEqual(expect.objectContaining({
      name: 'A',
      value: 'A',
    }));
  });

  test('can lookup by index', () => {
    const found = db.lookup('thing', 'name', 'equals', 'A');

    expect(found).toContainEqual(expect.objectContaining({
      name: 'A',
      value: 'A',
    }));
  });
});