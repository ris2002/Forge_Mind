import { get, post } from "../../api/client";

const BASE = "/api/modules/mailmind";

export const mailmindApi = {
  // emails
  list:           () => get(`${BASE}/emails`),
  listFiltered:   (from, to, flaggedOnly) => {
    const params = new URLSearchParams();
    if (from) params.append("date_from", from);
    if (to) params.append("date_to", to);
    if (flaggedOnly) params.append("flagged_only", "true");
    return get(`${BASE}/emails?${params}`);
  },
  fetchInbox:     () => post(`${BASE}/emails/fetch`),
  summarise:      (id) => post(`${BASE}/emails/${id}/summarise`),
  flag:           (id) => post(`${BASE}/emails/flag`, { email_id: id }),
  dismiss:        (id) => post(`${BASE}/emails/dismiss`, { email_id: id }),
  blockSender:    (id) => post(`${BASE}/emails/${id}/block-sender`),

  // reply
  draftReply:     (id, intent) => post(`${BASE}/reply/draft`, { email_id: id, user_intent: intent }),
  sendReply:      (id, draft) => post(`${BASE}/reply/send`, { email_id: id, draft }),

  // blocklist
  getBlocklist:   () => get(`${BASE}/blocklist`),
  addBlock:       (entry) => post(`${BASE}/blocklist/add`, { entry }),
  removeBlock:    (entry) => post(`${BASE}/blocklist/remove`, { entry }),

  // daemon
  daemonStatus:   () => get(`${BASE}/daemon/status`),
  startDaemon:    () => post(`${BASE}/daemon/start`),

  // module settings
  getSettings:    () => get(`${BASE}/settings`),
  saveSettings:   (s) => post(`${BASE}/settings`, s),
};
