import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameCatalogItem,
  GameClientMessage,
  GameJoinResponse,
  GameRoomView,
  GameServerMessage,
} from '@cafeflow/shared';
import { api } from './api';

/** Table games: the QR sticker is the room, the seat token is the identity. */
export const gamesApi = {
  catalog: () => api.get<{ games: GameCatalogItem[] }>('/public/games/catalog'),
  join: (input: { qrToken: string; gameId: string; nameFa?: string }) =>
    api.post<GameJoinResponse>('/public/games/join', input),
};

export function gamesSocketUrl(seatToken: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/games?seat=${encodeURIComponent(seatToken)}`;
}

export type RoomConnection = 'connecting' | 'open' | 'closed' | 'unauthorized';

export interface GameRoomHandle {
  room: GameRoomView | null;
  state: Record<string, any> | null;
  connection: RoomConnection;
  error: string | null;
  send: (message: GameClientMessage) => void;
  move: (move: Record<string, unknown>) => void;
  clearError: () => void;
}

/**
 * One socket per seat.
 *
 * A closed socket is retried with the same seat token — the server keeps the
 * seat for a grace period, so a locked phone or a tunnel comes back to the same
 * cards. A 401 means the seat is gone (server restarted or the table session
 * ended) and the page must offer a fresh join instead of retrying for ever.
 */
export function useGameRoom(seatToken: string | null): GameRoomHandle {
  const [room, setRoom] = useState<GameRoomView | null>(null);
  const [state, setState] = useState<Record<string, any> | null>(null);
  const [connection, setConnection] = useState<RoomConnection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    if (!seatToken) {
      setConnection('closed');
      return;
    }

    closedByUs.current = false;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnection(attempt === 0 ? 'connecting' : 'closed');
      const socket = new WebSocket(gamesSocketUrl(seatToken));
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnection('open');
      };

      socket.onmessage = (event) => {
        let message: GameServerMessage;
        try {
          message = JSON.parse(String(event.data)) as GameServerMessage;
        } catch {
          return;
        }
        if (message.type === 'room') setRoom(message.room);
        else if (message.type === 'state') setState(message.state);
        else if (message.type === 'error') setError(message.message);
      };

      // A dropped Wi-Fi looks like any other close; only the server's 4401 means
      // the seat itself is gone, so a tunnel never costs the guest their cards.
      socket.onerror = () => undefined;

      socket.onclose = (event) => {
        socketRef.current = null;
        if (closedByUs.current || disposed) {
          setConnection('closed');
          return;
        }
        if (event.code === 4401) {
          setConnection('unauthorized');
          return;
        }
        if (event.code === 4400) {
          setConnection('closed');
          return;
        }
        attempt += 1;
        if (attempt > 30) {
          setConnection('closed');
          return;
        }
        retryRef.current = window.setTimeout(connect, Math.min(4000, 600 * attempt));
      };
    };

    connect();

    return () => {
      disposed = true;
      closedByUs.current = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [seatToken]);

  const send = useCallback((message: GameClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('اتصال به میز برقرار نیست؛ یک لحظه صبر کنید.');
      return;
    }
    socket.send(JSON.stringify(message));
  }, []);

  const move = useCallback(
    (payload: Record<string, unknown>) => send({ type: 'move', move: payload }),
    [send],
  );

  return {
    room,
    state,
    connection,
    error,
    send,
    move,
    clearError: () => setError(null),
  };
}
