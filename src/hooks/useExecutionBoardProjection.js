import { useEffect, useState } from "react";
import {
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
} from "../execution/execution-board-store-repository.js";

function errorText(error) {
  return error?.code || error?.message || String(error);
}

export default function useExecutionBoardProjection() {
  const [state, setState] = useState(() => {
    try {
      return { store: readExecutionBoardStore(), error: "" };
    } catch (error) {
      return { store: null, error: errorText(error) };
    }
  });

  useEffect(() => {
    try {
      return subscribeExecutionBoardStore({
        listener: (snapshot) => setState({ store: snapshot, error: "" }),
      });
    } catch (error) {
      setState({ store: null, error: errorText(error) });
      return undefined;
    }
  }, []);

  return state;
}
