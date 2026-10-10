import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  directoryEntryGrades, directoryGradeCounts, directoryNavigationIntent, directoryPage, directoryTargetFromUrl, directoryThumbnailUrl,
  fetchDirectoryPreparedSnapshot, fetchDirectorySnapshot, filterDirectoryEntries, finalizeDirectorySnapshot,
  normalizeDirectorySnapshot, prepareDirectorySnapshot, sortDirectoryEntries,
} from '../src/blackbaud/directory.ts';
import type { DirectoryEntry, DirectoryTarget } from '../src/blackbaud/directory.ts';

const origin = 'https://example.myschoolapp.com';
const photoBase = 'https://photos.myschoolcdn.com/ftpimages/1/user/';

interface NativeDirectoryFixture {
  UserID: number;
  FirstName: string;
  LastName: string;
  PublishUserProfile: boolean;
  PublishEmail: boolean;
  EmailBad: boolean;
  Email: string;
  LargeFileName: string;
  Nickname: string;
  GradeDisplay: string;
  GradeNumericDisplay: string;
  Grade: string;
  UserNameFormatted: string;
  TotalCount: number;
}

function nativePerson(id = 1, overrides: Partial<NativeDirectoryFixture> = {}): NativeDirectoryFixture {
  return {
    UserID: id, FirstName: 'Ada', LastName: 'Example', PublishUserProfile: true, PublishEmail: true,
    EmailBad: false, Email: 'ada@example.org', LargeFileName: 'large_user_example.jpg', Nickname: 'Addie',
    GradeDisplay: '11', GradeNumericDisplay: '', Grade: '', UserNameFormatted: 'Ada (Addie) Example', TotalCount: 1,
    ...overrides,
  };
}

function nativeSnapshot(...people: NativeDirectoryFixture[]): NativeDirectoryFixture[] {
  return people.map((person, index) => ({ ...person, TotalCount: index === 0 ? people.length : 0 }));
}

function entry(id: number, firstName: string, lastName: string, grade = ''): DirectoryEntry {
  return { userId: id, firstName, lastName, nickname: '', displayName: `${firstName} ${lastName}`, grade, email: '', photoUrl: '', canViewProfile: true };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function currentRoute(id = '27'): DirectoryTarget {
  currentUrl(`${origin}/app/student?svcid=edu#directory/${id}`);
  return { directoryId: id, origin };
}

function currentUrl(url: string): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { location: new URL(url) } });
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('directory targets come from the current native route rather than a school-specific identifier', () => {
  assert.deepEqual(directoryTargetFromUrl(new URL(`${origin}/app/student?svcid=edu#directory/27`)), { directoryId: '27', origin });
  assert.deepEqual(directoryTargetFromUrl(new URL(`${origin}/app/teacher#directory/999/?view=list`)), { directoryId: '999', origin });
  for (const url of [
    'http://example.myschoolapp.com/app/student#directory/27', 'https://foreign.example/app/student#directory/27',
    `${origin}/app/student#directory/0`, `${origin}/app/student#directory/027`, `${origin}/app/student#directory/9007199254740992`,
    `${origin}/app/student#directory/27/other`, `${origin}/app/student#otherdirectory/27`,
    `${origin}/signin#directory/27`, `${origin}/app/student/other#directory/27`,
    'https://name:secret@example.myschoolapp.com/app/student#directory/27',
  ]) assert.equal(directoryTargetFromUrl(new URL(url)), null, url);
});

test('complete directory responses retain only display fields and resolve the native photo prefix', () => {
  const snapshot = normalizeDirectorySnapshot([{ ...nativePerson(), AddressLine1: 'Private street', SpouseID: 42, Deceased: false }], origin, photoBase);
  assert.deepEqual(snapshot, { totalCount: 1, reportedTotalCount: 1, complete: true, entries: [{
    userId: 1, firstName: 'Ada', lastName: 'Example', nickname: 'Addie', displayName: 'Ada (Addie) Example',
    grade: '11', email: 'ada@example.org', photoUrl: `${photoBase}large_user_example.jpg`, canViewProfile: true,
  }] });
  assert.deepEqual(normalizeDirectorySnapshot([], origin), { entries: [], totalCount: 0, reportedTotalCount: 0, complete: true });
});

test('prepared data retains only published display fields and safe photo filenames until metadata arrives', () => {
  const people = nativeSnapshot(
    nativePerson(1, { FirstName: 'Zoe', LastName: 'Zulu', UserNameFormatted: 'Zoe Zulu' }),
    nativePerson(2, { FirstName: 'Ada', LastName: 'Alpha', UserNameFormatted: 'Ada Alpha', PublishEmail: false }),
    nativePerson(3, { PublishUserProfile: false, LargeFileName: 'large_user_private.jpg' }),
    nativePerson(4, { LargeFileName: 'large_user_../../secret.jpg' }),
  ).map((person) => ({ ...person, AddressLine1: 'Private street', PreferredAddressId: 999, SpouseID: 555, JobTitle: 'Private title' }));
  const prepared = prepareDirectorySnapshot(people, origin);
  assert.deepEqual(prepared.photoFiles, [{ userId: 1, fileName: 'large_user_example.jpg' }, { userId: 2, fileName: 'large_user_example.jpg' }]);
  assert.equal(prepared.snapshot.entries.every((person) => person.photoUrl === ''), true);
  assert.equal(prepared.snapshot.entries.find((person) => person.userId === 2)!.email, '');
  assert.deepEqual(prepared.snapshot.entries.map((person) => person.userId), [2, 3, 4, 1]);
  assert.deepEqual(people.map((person) => person.UserID), [1, 2, 3, 4]);
  assert.equal(/Private street|PreferredAddressId|SpouseID|Private title|large_user_private/u.test(JSON.stringify(prepared)), false);
  people[0]!.FirstName = 'Changed raw person';
  people[0]!.LargeFileName = 'large_user_changed.jpg';
  assert.equal(prepared.snapshot.entries.find((person) => person.userId === 1)!.firstName, 'Zoe');
  const finalized = finalizeDirectorySnapshot(prepared, origin, photoBase);
  assert.equal(finalized.entries.find((person) => person.userId === 1)!.photoUrl, `${photoBase}large_user_example.jpg`);
  assert.equal(finalized.entries.find((person) => person.userId === 3)!.photoUrl, '');
  assert.equal(finalized.entries.find((person) => person.userId === 4)!.photoUrl, '');
  assert.equal(prepared.snapshot.entries.every((person) => person.photoUrl === ''), true);
  assert.equal(finalizeDirectorySnapshot(prepared, origin, 'https://foreign.example/user/').entries.every((person) => person.photoUrl === ''), true);
  assert.equal(finalizeDirectorySnapshot(prepared, origin).entries.every((person) => person.photoUrl === ''), true);
});

test('prepared snapshots retain already validated full URLs without requiring a photo prefix', () => {
  const safePhoto = `${photoBase}large_user_full.jpg`;
  const prepared = prepareDirectorySnapshot([nativePerson(1, { LargeFileName: safePhoto })], origin);
  assert.deepEqual(prepared.photoFiles, []);
  assert.equal(finalizeDirectorySnapshot(prepared, origin).entries[0]!.photoUrl, safePhoto);
});

test('early navigation intent accepts native same-document directories regardless of their configured labels', () => {
  const source = new URL(`${origin}/app/student?svcid=edu#myday/progress`);
  const page = new JSDOM('<nav id="topnav-containter"><a href="#directory/27">Students</a></nav>', { url: source.href });
  try {
    const anchor = page.window.document.querySelector('a')!;
    const intent = directoryNavigationIntent(anchor, source);
    assert.equal(intent?.url.href, `${origin}/app/student?svcid=edu#directory/27`);
    assert.deepEqual(intent?.target, { directoryId: '27', origin });
    for (const href of [`${origin}/app/teacher?svcid=edu#directory/27`, `${origin}/app/student?svcid=other#directory/27`, 'https://other.myschoolapp.com/app/student?svcid=edu#directory/27', 'https://name:secret@example.myschoolapp.com/app/student?svcid=edu#directory/27', '#profile/27', '#directory/0', '#directory/27/other', '#directory/27?unexpected=1']) {
      anchor.setAttribute('href', href);
      assert.equal(directoryNavigationIntent(anchor, source), null);
    }
    anchor.setAttribute('href', '#directory/27');
    for (const label of ['Students', 'Faculty', 'Parents', 'Alumni Connections', 'Community Volunteers']) {
      anchor.textContent = label;
      assert.deepEqual(directoryNavigationIntent(anchor, source)?.target, { directoryId: '27', origin }, label);
    }
    anchor.target = '_SELF';
    assert.deepEqual(directoryNavigationIntent(anchor, source)?.target, { directoryId: '27', origin });
    anchor.removeAttribute('target');
    assert.equal(directoryNavigationIntent(anchor, new URL(`https://name:secret@example.myschoolapp.com/app/student?svcid=edu#myday/progress`)), null);
    anchor.setAttribute('download', '');
    assert.equal(directoryNavigationIntent(anchor, source), null);
    anchor.removeAttribute('download');
    anchor.target = '_blank';
    assert.equal(directoryNavigationIntent(anchor, source), null);
    anchor.removeAttribute('target');
    page.window.document.body.append(anchor);
    assert.equal(directoryNavigationIntent(anchor, source), null);
  } finally { page.window.close(); }
});

test('native snapshots carry their complete count on the first row and zero on following rows', () => {
  const people = nativeSnapshot(nativePerson(1), nativePerson(2), nativePerson(3));
  assert.deepEqual(people.map((person) => person.TotalCount), [3, 0, 0]);
  assert.equal(normalizeDirectorySnapshot(people, origin).totalCount, 3);
  assert.equal(normalizeDirectorySnapshot(people.map((person) => ({ ...person, TotalCount: 3 })), origin).totalCount, 3);
  assert.equal(normalizeDirectorySnapshot([people[0], { ...people[1]!, TotalCount: 3 }, people[2]], origin).totalCount, 3);
  for (const payload of [
    [{ ...people[0]!, TotalCount: 0 }, people[1], people[2]],
    [people[0], { ...people[1]!, TotalCount: 1 }, people[2]],
    [people[0], { ...people[1]!, TotalCount: undefined }, people[2]],
    [people[0], { ...people[1]!, TotalCount: '0' }, people[2]],
    [people[0], { ...people[1]!, TotalCount: false }, people[2]],
  ]) assert.throws(() => normalizeDirectorySnapshot(payload, origin), /incomplete or.*unsupported format/);
});

test('ambiguous and malformed responses fail instead of presenting contradictory directory data', () => {
  for (const payload of [
    null, {}, { Items: [nativePerson()] }, [null], [{ ...nativePerson(), UserID: {} }],
    [{ ...nativePerson(), UserID: 0 }], [{ ...nativePerson(), UserID: '1' }],
    [{ ...nativePerson(), UserID: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...nativePerson(), TotalCount: 0 }], [{ ...nativePerson(), TotalCount: '1' }],
    [{ ...nativePerson(), TotalCount: -1 }], [{ ...nativePerson(), TotalCount: 1.5 }],
    [{ ...nativePerson(), TotalCount: Number.MAX_SAFE_INTEGER + 1 }], [{ ...nativePerson(), TotalCount: undefined }],
    nativeSnapshot(nativePerson(), nativePerson()),
    [{ ...nativePerson(), FirstName: null }], [{ ...nativePerson(), LastName: undefined }],
    [{ ...nativePerson(), FirstName: '', LastName: '' }], [{ ...nativePerson(), FirstName: '<img src=x>' }],
    [{ ...nativePerson(), PublishUserProfile: 1 }], [{ ...nativePerson(), PublishEmail: undefined }],
    [{ ...nativePerson(), FirstName: 'A'.repeat(301) }],
  ]) assert.throws(() => normalizeDirectorySnapshot(payload, origin), /incomplete or.*unsupported format/);
  assert.throws(() => normalizeDirectorySnapshot(Array.from({ length: 10_001 }, (_, index) => nativePerson(index + 1, { TotalCount: 10_001 })), origin), /unsupported format/);
});

test('native result caps retain received counts while reporting that the matching directory is incomplete', () => {
  const people = nativeSnapshot(nativePerson(1), nativePerson(2), nativePerson(3));
  people[0]!.TotalCount = 20;
  const snapshot = normalizeDirectorySnapshot(people, origin, photoBase);
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.totalCount, 3);
  assert.equal(snapshot.reportedTotalCount, 20);
  assert.equal(snapshot.complete, false);
  assert.equal(directoryPage(snapshot.entries, 9, 2).pageCount, 2);
  assert.equal(normalizeDirectorySnapshot(people.map((person) => ({ ...person, TotalCount: 20 })), origin).complete, false);
  for (const payload of [
    [{ ...people[0]!, TotalCount: 2 }, people[1], people[2]],
    [people[0], { ...people[1]!, TotalCount: 3 }, people[2]],
    [people[0], { ...people[1]!, TotalCount: 19 }, people[2]],
    [people[0], { ...people[1]!, TotalCount: -1 }, people[2]],
    [people[0], { ...people[1]!, TotalCount: 0.5 }, people[2]],
    [people[0], { ...people[1]!, UserID: 1 }, people[2]],
  ]) assert.throws(() => normalizeDirectorySnapshot(payload, origin), /unsupported format/);
});

test('prepared and finalized capped snapshots preserve completeness metadata through photo projection and sorting', () => {
  const people = nativeSnapshot(nativePerson(1, { LastName: 'Zulu' }), nativePerson(2, { LastName: 'Alpha', PublishEmail: false }));
  people[0]!.TotalCount = 100;
  const prepared = prepareDirectorySnapshot(people, origin);
  assert.equal(prepared.snapshot.totalCount, 2);
  assert.equal(prepared.snapshot.reportedTotalCount, 100);
  assert.equal(prepared.snapshot.complete, false);
  assert.deepEqual(prepared.snapshot.entries.map((person) => person.userId), [2, 1]);
  const finalized = finalizeDirectorySnapshot(prepared, origin, photoBase);
  assert.equal(finalized.totalCount, 2);
  assert.equal(finalized.reportedTotalCount, 100);
  assert.equal(finalized.complete, false);
  assert.equal(finalized.entries[0]!.email, '');
  assert.equal(finalized.entries[0]!.photoUrl, `${photoBase}large_user_example.jpg`);
  assert.equal(prepared.snapshot.entries.every((person) => !person.photoUrl), true);
});

test('name-only profiles exclude unpublished contact, nickname, grade, and hidden configured-name fields', () => {
  const snapshot = normalizeDirectorySnapshot([nativePerson(1, {
    FirstName: 'PrivateLegal', Nickname: 'PrivateNickname', UserNameFormatted: 'Preferred Example', PublishUserProfile: false,
  })], origin, photoBase);
  assert.deepEqual(snapshot.entries[0], {
    userId: 1, firstName: '', lastName: 'Example', nickname: '', displayName: 'Preferred Example', grade: '', email: '', photoUrl: '', canViewProfile: false,
  });
  for (const query of ['PrivateLegal', 'PrivateNickname', 'ada@example.org', 'Private street']) {
    assert.equal(filterDirectoryEntries(snapshot.entries, { query }).length, 0);
  }
  assert.equal(filterDirectoryEntries(snapshot.entries, { query: 'preferred example' }).length, 1);
  assert.deepEqual(directoryGradeCounts(snapshot.entries), []);
});

test('email needs explicit profile, publish, and delivery flags and is never inferred from a raw value', () => {
  for (const overrides of [
    { PublishEmail: false }, { PublishUserProfile: false }, { EmailBad: true },
    { EmailBad: undefined }, { EmailBad: 0 }, { Email: 'person@example.org\nBcc:other@example.org' }, { Email: 'not an email' },
    { Email: 'person@example.org?bcc=other@example.org' }, { Email: 'person@example.org,other@example.org' },
  ]) {
    assert.equal(normalizeDirectorySnapshot([{ ...nativePerson(), ...overrides }], origin).entries[0]!.email, '');
  }
  assert.equal(normalizeDirectorySnapshot([nativePerson(1, { Email: ' ada@example.org ' })], origin).entries[0]!.email, 'ada@example.org');
});

test('photos accept recognized native HTTPS paths and refuse guessed or unsafe prefixes', () => {
  assert.equal(normalizeDirectorySnapshot([nativePerson()], origin).entries[0]!.photoUrl, '');
  assert.equal(normalizeDirectorySnapshot([nativePerson(1, { LargeFileName: '/ftpimages/1/user/large_user_example.jpg?resize=80,80' })], origin).entries[0]!.photoUrl,
    `${origin}/ftpimages/1/user/large_user_example.jpg?resize=80,80`);
  for (const prefix of ['http://photos.myschoolcdn.com/ftpimages/1/user/', 'https://user:secret@photos.myschoolcdn.com/ftpimages/1/user/', 'https://photos.myschoolcdn.com/other/', 'https://foreign.example/user/', `${photoBase}?token=secret`, `${photoBase}#fragment`]) {
    assert.equal(normalizeDirectorySnapshot([nativePerson()], origin, prefix).entries[0]!.photoUrl, '', prefix);
  }
  for (const LargeFileName of [
    'javascript:alert(1)', 'data:image/png,bad', 'https://user:secret@photos.myschoolcdn.com/user/large_user_example.jpg',
    'http://photos.myschoolcdn.com/user/large_user_example.jpg', 'https://foreign.example/user/large_user_example.jpg',
    'https://photos.myschoolcdn.com:444/user/large_user_example.jpg',
    'https://myschoolcdn.com.foreign.example/user/large_user_example.jpg', 'large_user_../../secret', '/other/photo.jpg',
    '/user/large_user_example.jpg#fragment', '/user/large_user_example.jpg?token=secret',
    '/user/large_user_example.jpg?resize=80,80&resize=40,40', '/user/large_user_example%2fsecret.jpg',
  ]) {
    assert.equal(normalizeDirectorySnapshot([nativePerson(1, { LargeFileName })], origin, photoBase).entries[0]!.photoUrl, '', LargeFileName);
  }
});

test('formatted names stay plain text, optional fields are bounded, and grade uses verified display fields', () => {
  const snapshot = normalizeDirectorySnapshot(nativeSnapshot(
    nativePerson(1, { UserNameFormatted: '<strong>Ada Example</strong>', GradeDisplay: '', GradeNumericDisplay: '3', Grade: 'raw grade' }),
    nativePerson(2, { UserNameFormatted: '', GradeDisplay: '', GradeNumericDisplay: '', Grade: 'Kindergarten', Nickname: 'A'.repeat(301) }),
  ), origin);
  assert.equal(snapshot.entries[0]!.displayName, 'Ada Example');
  assert.equal(snapshot.entries[0]!.grade, '3');
  assert.equal(snapshot.entries[1]!.grade, 'Kindergarten');
  assert.equal(snapshot.entries[1]!.nickname, '');
});

test('directory thumbnails use small native images while retaining the original full-size photo', () => {
  const person = normalizeDirectorySnapshot([nativePerson()], origin, photoBase).entries[0]!;
  const thumbnail = new URL(directoryThumbnailUrl(person.photoUrl, origin));
  assert.equal(thumbnail.origin, new URL(photoBase).origin);
  assert.equal(thumbnail.pathname, '/ftpimages/1/user/large_user_example.jpg');
  assert.equal(thumbnail.searchParams.get('resize'), '96,96');
  assert.equal(person.photoUrl, `${photoBase}large_user_example.jpg`);
  assert.equal(new URL(directoryThumbnailUrl(`${person.photoUrl}?resize=80,80`, origin)).searchParams.get('resize'), '96,96');
  assert.equal(directoryThumbnailUrl('https://foreign.example/user/large_user_example.jpg', origin), '');
  assert.equal(directoryThumbnailUrl(`${person.photoUrl}?token=secret`, origin), '');
  assert.equal(directoryThumbnailUrl('', origin), '');
});

test('local search ignores accents and punctuation, combines name tokens, and never searches contact fields', () => {
  const people = [
    { ...entry(1, 'José', "O’Neill", '11'), nickname: 'Pepe', email: 'private@example.org' },
    entry(2, 'Grace', 'Example', '3'),
  ];
  assert.deepEqual(filterDirectoryEntries(people, { query: '  jose   pepe  ' }).map((person) => person.userId), [1]);
  assert.deepEqual(filterDirectoryEntries(people, { query: 'o neill' }).map((person) => person.userId), [1]);
  assert.equal(filterDirectoryEntries(people, { query: 'private@example.org' }).length, 0);
  assert.deepEqual(filterDirectoryEntries(people, { query: 'e', grade: '3' }).map((person) => person.userId), [2]);
  assert.equal(filterDirectoryEntries(people, { grade: 'unknown' }).length, 0);
});

test('sorts are deterministic and nonmutating, and grade counts use natural display order', () => {
  const people = [entry(4, 'Grace', 'Same', '11'), entry(3, 'Ada', 'Same', '3'), entry(2, 'Ada', 'Same', '3'), entry(1, 'Zoe', 'Alpha', '')];
  assert.deepEqual(sortDirectoryEntries(people).map((person) => person.userId), [1, 2, 3, 4]);
  assert.deepEqual(sortDirectoryEntries(people, 'first').map((person) => person.userId), [2, 3, 4, 1]);
  assert.deepEqual(people.map((person) => person.userId), [4, 3, 2, 1]);
  assert.deepEqual(directoryGradeCounts(people), [{ grade: '3', count: 2 }, { grade: '11', count: 1 }]);
  const nameOnly = { ...entry(5, '', 'Same'), displayName: 'Preferred Same', canViewProfile: false };
  assert.equal(sortDirectoryEntries([nameOnly, people[1]!], 'first')[1], nameOnly);
});

test('pagination clamps stale page positions after filtering and handles an empty directory', () => {
  const people = [entry(1, 'One', 'Example'), entry(2, 'Two', 'Example'), entry(3, 'Three', 'Example')];
  assert.deepEqual(directoryPage(people, 9, 2), { entries: [people[2]], page: 2, pageCount: 2, totalCount: 3 });
  assert.deepEqual(directoryPage([], 9, 2), { entries: [], page: 1, pageCount: 1, totalCount: 0 });
  assert.equal(directoryPage(people, -1, 2).page, 1);
  assert.equal(directoryPage(people, NaN, 2).page, 1);
  for (const size of [0, -1, 1.5, NaN, 1001]) assert.throws(() => directoryPage(people, 1, size), /page size/);
});

test('grade filters sort early years before numbered grades and unfamiliar labels naturally afterward', () => {
  const grades = ['12', 'Kindergarten', 'Pre-K', '3', 'K', 'PK', '1', 'Group 11', 'Group 2', 'Other'];
  const people = grades.map((grade, index) => entry(index + 1, 'Example', 'Student', grade));
  assert.deepEqual(directoryGradeCounts(people).map((item) => item.grade), ['PK', 'Pre-K', 'K', 'Kindergarten', '1', '3', '12', 'Group 2', 'Group 11', 'Other']);
});

test('published faculty multi-grade display values filter and count individual grades once per person', () => {
  const people = normalizeDirectorySnapshot(nativeSnapshot(
    nativePerson(1, { GradeDisplay: '10, 11, 12, 9' }),
    nativePerson(2, { GradeDisplay: '1, 2, 3, 4, 5, K, 3, K, ' }),
    nativePerson(3, { GradeDisplay: '10' }),
    nativePerson(4, { GradeDisplay: '9, 10', PublishUserProfile: false }),
  ), origin).entries;
  assert.equal(people[0]!.grade, '10, 11, 12, 9');
  assert.deepEqual(directoryEntryGrades(people[0]!), ['9', '10', '11', '12']);
  assert.deepEqual(directoryEntryGrades(people[1]!), ['K', '1', '2', '3', '4', '5']);
  assert.deepEqual(directoryEntryGrades(people[2]!), ['10']);
  assert.deepEqual(directoryEntryGrades(people[3]!), []);
  assert.deepEqual(directoryGradeCounts(people), [
    { grade: 'K', count: 1 }, { grade: '1', count: 1 }, { grade: '2', count: 1 }, { grade: '3', count: 1 },
    { grade: '4', count: 1 }, { grade: '5', count: 1 }, { grade: '9', count: 1 }, { grade: '10', count: 2 },
    { grade: '11', count: 1 }, { grade: '12', count: 1 },
  ]);
  assert.deepEqual(filterDirectoryEntries(people, { grade: '10' }).map((person) => person.userId), [1, 3]);
  assert.deepEqual(filterDirectoryEntries(people, { grade: 'K' }).map((person) => person.userId), [2]);
  assert.equal(filterDirectoryEntries(people, { grade: '10, 11, 12, 9' }).length, 0);
  assert.equal(people[0]!.grade, '10, 11, 12, 9');
  const privateEntry = { ...entry(5, 'Private', 'Example', '9, 10'), canViewProfile: false };
  assert.deepEqual(directoryEntryGrades(privateEntry), []);
  assert.deepEqual(directoryGradeCounts([privateEntry]), []);
});

test('directory fetch requests the current route with normal same-origin authentication and forwards cancellation', async (t) => {
  const target = currentRoute('27');
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    requests += 1;
    const request = new URL(String(path), origin);
    assert.equal(request.pathname, '/api/directory/directoryresultsget');
    assert.deepEqual([...request.searchParams], [['directoryId', '27'], ['searchVal', ''], ['facets', ''], ['searchAll', 'false']]);
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.signal, controller.signal);
    return new Response(JSON.stringify([nativePerson()]));
  });
  assert.equal((await fetchDirectorySnapshot(target, controller.signal, photoBase)).entries[0]!.photoUrl, `${photoBase}large_user_example.jpg`);
  assert.equal(requests, 1);
  await assert.rejects(fetchDirectorySnapshot({ ...target, directoryId: '28' }, controller.signal), /identifier/);
  await assert.rejects(fetchDirectorySnapshot({ ...target, origin: 'https://other.myschoolapp.com' }, controller.signal), /identifier/);
  await assert.rejects(fetchDirectorySnapshot({ ...target, directoryId: '27&other=true' }, controller.signal), /identifier/);
  assert.equal(requests, 1);
});

test('native server name search escapes the query without adding contact search or facets and reports a capped response', async (t) => {
  const target = currentRoute();
  const controller = new AbortController();
  const query = "Élodie + O'Neil & family?#=";
  const people = nativeSnapshot(nativePerson(1), nativePerson(2, { PublishEmail: false }));
  people[0]!.TotalCount = 25;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    const request = new URL(String(path), origin);
    assert.equal(request.hash, '');
    assert.deepEqual([...request.searchParams], [['directoryId', '27'], ['searchVal', query], ['facets', ''], ['searchAll', 'false']]);
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.signal, controller.signal);
    return new Response(JSON.stringify(people));
  });
  const result = await fetchDirectorySnapshot(target, controller.signal, photoBase, query);
  assert.equal(result.totalCount, 2);
  assert.equal(result.reportedTotalCount, 25);
  assert.equal(result.complete, false);
  assert.equal(result.entries[1]!.email, '');
});

test('server search bounds plain query strings before issuing a request and accepts the maximum length', async (t) => {
  const target = currentRoute();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    requests += 1;
    assert.equal(new URL(String(path), origin).searchParams.get('searchVal'), 'A'.repeat(200));
    return new Response('[]');
  });
  for (const query of ['A'.repeat(201), 'Name\nOther', 'Name\tOther', '<name>', '\u0000', 12 as unknown as string]) {
    await assert.rejects(fetchDirectorySnapshot(target, new AbortController().signal, undefined, query), /search is invalid/);
  }
  assert.equal(requests, 0);
  const result = await fetchDirectorySnapshot(target, new AbortController().signal, undefined, 'A'.repeat(200));
  assert.deepEqual(result, { entries: [], totalCount: 0, reportedTotalCount: 0, complete: true });
  assert.equal(requests, 1);
});

test('server search discards a late capped response after cancellation and later searches remain usable', async (t) => {
  const target = currentRoute();
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', (path: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(new URL(String(path), origin).searchParams.get('searchVal'), 'Example');
    assert.equal(options?.signal, controller.signal);
    return new Promise<Response>((done) => { resolve = done; });
  });
  const pending = fetchDirectorySnapshot(target, controller.signal, photoBase, 'Example');
  controller.abort();
  resolve(new Response(JSON.stringify([{ ...nativePerson(), TotalCount: 30 }])));
  await assert.rejects(pending, { name: 'AbortError' });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(nativeSnapshot(nativePerson(1), nativePerson(2)))));
  const latest = await fetchDirectorySnapshot(target, new AbortController().signal, photoBase, 'Example');
  assert.equal(latest.complete, true);
  assert.equal(latest.totalCount, 2);
  assert.equal(latest.reportedTotalCount, 2);
});

test('directory fetch discards a response that finishes after cancellation', async (t) => {
  const target = currentRoute();
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  const pending = fetchDirectorySnapshot(target, controller.signal);
  controller.abort();
  resolve(new Response(JSON.stringify([nativePerson()])));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('directory fetch cannot return a prior directory after native navigation changes its identity', async (t) => {
  const target = currentRoute('27');
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  const pending = fetchDirectorySnapshot(target, new AbortController().signal);
  currentRoute('28');
  resolve(new Response(JSON.stringify([nativePerson()])));
  await assert.rejects(pending, /directory changed/);
});

test('strict directory refresh rejects the same directory ID when the exact native route changes', async (t) => {
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  for (const destination of [
    `${origin}/app/teacher?svcid=edu#directory/27`,
    `${origin}/app/student?svcid=other#directory/27`,
    `${origin}/app/student?svcid=edu#directory/27?view=list`,
  ]) {
    const target = currentRoute('27');
    const pending = fetchDirectorySnapshot(target, new AbortController().signal);
    currentUrl(destination);
    resolve(new Response(JSON.stringify([nativePerson()])));
    await assert.rejects(pending, /directory changed/);
  }
});

test('an early same-document read may start on Progress and complete after its intended directory navigation', async (t) => {
  const source = `${origin}/app/student?svcid=edu#myday/progress`;
  const destination = new URL(`${origin}/app/student?svcid=edu#directory/27`);
  const target = { directoryId: '27', origin };
  currentUrl(source);
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', (path: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(String(path), '/api/directory/directoryresultsget?directoryId=27&searchVal=&facets=&searchAll=false');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.signal, controller.signal);
    return new Promise<Response>((done) => { resolve = done; });
  });
  const pending = fetchDirectoryPreparedSnapshot(target, controller.signal, destination);
  currentUrl(destination.href);
  resolve(new Response(JSON.stringify([nativePerson()])));
  const prepared = await pending;
  assert.equal(prepared.snapshot.totalCount, 1);
  assert.equal(prepared.snapshot.entries[0]!.photoUrl, '');
  assert.deepEqual(prepared.photoFiles, [{ userId: 1, fileName: 'large_user_example.jpg' }]);
});

test('early reads reject cross-document intent before a request and default to the current actual directory', async (t) => {
  const source = `${origin}/app/student?svcid=edu#myday/progress`;
  currentUrl(source);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response(JSON.stringify([nativePerson()])); });
  const target = { directoryId: '27', origin };
  for (const destination of [
    `${origin}/app/teacher?svcid=edu#directory/27`, `${origin}/app/student?svcid=other#directory/27`,
    'https://other.myschoolapp.com/app/student?svcid=edu#directory/27',
    `https://name:secret@example.myschoolapp.com/app/student?svcid=edu#directory/27`,
    `${origin}/app/student?svcid=edu#directory/28`, `${origin}/app/student?svcid=edu#profile/27`,
  ]) await assert.rejects(fetchDirectoryPreparedSnapshot(target, new AbortController().signal, new URL(destination)), /intent/);
  await assert.rejects(fetchDirectoryPreparedSnapshot(target, new AbortController().signal), /intent/);
  assert.equal(requests, 0);
  currentRoute('27');
  assert.equal((await fetchDirectoryPreparedSnapshot(target, new AbortController().signal)).snapshot.totalCount, 1);
  assert.equal(requests, 1);
});

test('early reads discard cancellation and navigation away from both source and intended destination', async (t) => {
  const source = `${origin}/app/student?svcid=edu#myday/progress`;
  const destination = new URL(`${origin}/app/student?svcid=edu#directory/27`);
  const target = { directoryId: '27', origin };
  let resolve!: (response: Response) => void;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => { requests += 1; return new Promise<Response>((done) => { resolve = done; }); });
  const aborted = new AbortController();
  aborted.abort();
  currentUrl(source);
  await assert.rejects(fetchDirectoryPreparedSnapshot(target, aborted.signal, destination), { name: 'AbortError' });
  assert.equal(requests, 0);
  const controller = new AbortController();
  const cancelled = fetchDirectoryPreparedSnapshot(target, controller.signal, destination);
  controller.abort();
  resolve(new Response(JSON.stringify([nativePerson()])));
  await assert.rejects(cancelled, { name: 'AbortError' });
  for (const stale of [`${origin}/app/student?svcid=edu#directory/28`, `${origin}/app/student?svcid=edu#myday/schedule`]) {
    currentUrl(source);
    const pending = fetchDirectoryPreparedSnapshot(target, new AbortController().signal, destination);
    currentUrl(stale);
    resolve(new Response(JSON.stringify([nativePerson()])));
    await assert.rejects(pending, /directory changed/);
  }
});

test('early reads clone their intended URL so later caller mutation cannot approve a stale destination', async (t) => {
  const source = `${origin}/app/student?svcid=edu#myday/progress`;
  const destination = new URL(`${origin}/app/student?svcid=edu#directory/27`);
  currentUrl(source);
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  const pending = fetchDirectoryPreparedSnapshot({ directoryId: '27', origin }, new AbortController().signal, destination);
  destination.hash = '#directory/28';
  currentUrl(destination.href);
  resolve(new Response(JSON.stringify([nativePerson()])));
  await assert.rejects(pending, /directory changed/);
});

test('directory fetch stops before already-aborted work and failures do not poison later reads', async (t) => {
  const target = currentRoute();
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return requests === 1 ? new Response('Unavailable', { status: 503 }) : new Response(JSON.stringify([nativePerson()]));
  });
  controller.abort();
  await assert.rejects(fetchDirectorySnapshot(target, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
  await assert.rejects(fetchDirectorySnapshot(target, new AbortController().signal), /503/);
  assert.equal((await fetchDirectorySnapshot(target, new AbortController().signal)).totalCount, 1);
  assert.equal(requests, 2);
});
