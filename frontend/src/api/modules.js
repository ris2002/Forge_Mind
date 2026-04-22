import { get } from "./client";

export const modulesApi = {
  list: () => get("/api/modules"),
};
