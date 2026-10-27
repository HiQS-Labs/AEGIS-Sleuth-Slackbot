// GH-279 smoke server: real WebAPI + bulk endpoint on a temp SLEUTH_DATA_DIR, with a fake live
// RemindersModule that removes closed reminders from the persisted file the way the real writer does.
// Usage: SLEUTH_DATA_DIR=$(mktemp -d) node PROJECT/2-WORKING/GH-279-smoke/server.js "$PWD" 19911
'use strict';
const path = require('path');
const fs = require('fs');
const Repo = process.argv[2];
const Port = Number(process.argv[3]);
const WebAPI = require(path.join(Repo, 'src/web-api'));
const workspaces = require(path.join(Repo, 'src/workspaces'));
const AdminAuth = require(path.join(Repo, 'src/admin-auth'));
const Ws = 'smokews';
const File = workspaces.GetSubdirPath('reminders', `${Ws}_reminders.json`);
fs.mkdirSync(path.dirname(File), { recursive: true });
const Mk = (Id, Text) => ({ ReminderID: Id, CreatedOn: '2026-09-01T00:00:00.000Z', ShouldPostOn: '2026-09-02T00:00:00.000Z',
  TargetChannelID: 'C1', OriginalChannelID: 'C1', OriginalMessageID: '1.1', OriginalSenderID: 'U1',
  ReminderMessageText: Text, IgnoreSnooze: false, AssigneeID: 'U1', AssigneeIDs: ['U1'], State: 'scheduled' });
fs.writeFileSync(File, JSON.stringify([
  Mk('aaaaaaaa-1111-4000-8000-000000000001', 'stale one'),
  Mk('bbbbbbbb-2222-4000-8000-000000000002', 'duplicate'),
  Mk('cccccccc-3333-4000-8000-000000000003', 'keep me'),
]));
workspaces.WorkspaceExistsAsync = async Name => Name === Ws;
const Close = Kind => async (Id, Reason) => {
  const List = JSON.parse(fs.readFileSync(File, 'utf8'));
  const Next = List.filter(R => R.ReminderID !== Id);
  if(Next.length === List.length) return false;
  fs.writeFileSync(File, JSON.stringify(Next));
  console.log(`server: ${Kind} ${Id} (${Reason})`);
  return true;
};
const Apps = new Map([[Ws, { RemindersModule: { CompleteReminderByIdAsync: Close('complete'), CancelReminderFromListAsync: Close('cancel') } }]]);
const Api = new WebAPI(Port, 'smoke-token', new Map(), { GetLastManualFilePath: () => null }, new AdminAuth(), {}, Apps);
Api.StartAsync().then(() => console.log('server: ready'));
