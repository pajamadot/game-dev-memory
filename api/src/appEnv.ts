import type { Env } from "./types";
import type { AuthContext } from "./auth/types";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
  };
};

