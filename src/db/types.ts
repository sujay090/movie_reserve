import type { Generated } from "kysely";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface GenresTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
}

export interface MoviesTable {
  id: Generated<string>;
  title: string;
  description: string;
  poster_url: string | null;
  duration_minutes: number;
  release_date: string | null;
  age_rating: string | null;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MovieGenresTable {
  movie_id: string;
  genre_id: string;
}

export interface TheatersTable {
  id: Generated<string>;
  name: string;
  address: string;
  city: string;
  timezone: string;
  status: "ACTIVE" | "INACTIVE";
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScreensTable {
  id: Generated<string>;
  theater_id: string;
  name: string;
  capacity: number;
  created_at: Generated<Date>;
}

export interface SeatsTable {
  id: Generated<string>;
  screen_id: string;
  row_label: string;
  seat_number: number;
  seat_type: "REGULAR" | "PREMIUM" | "ACCESSIBLE";
  is_active: boolean;
}

export interface ShowtimesTable {
  id: Generated<string>;
  movie_id: string;
  screen_id: string;
  starts_at: Date;
  ends_at: Date;
  ticket_price: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ShowtimeSeatsTable {
  showtime_id: string;
  seat_id: string;
  status: "AVAILABLE" | "RESERVED";
  reservation_id: string | null;
  reserved_at: Date | null;
}

export interface ReservationsTable {
  id: Generated<string>;
  reservation_code: string;
  user_id: string;
  showtime_id: string;
  status: "CONFIRMED" | "CANCELLED" | "EXPIRED";
  total_amount: string;
  cancelled_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReservationSeatsTable {
  reservation_id: string;
  seat_id: string;
  price: string;
}

export interface ReservationRequestsTable {
  idempotency_key: string;
  user_id: string;
  reservation_id: string;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  genres: GenresTable;
  movies: MoviesTable;
  movie_genres: MovieGenresTable;
  theaters: TheatersTable;
  screens: ScreensTable;
  seats: SeatsTable;
  showtimes: ShowtimesTable;
  showtime_seats: ShowtimeSeatsTable;
  reservations: ReservationsTable;
  reservation_seats: ReservationSeatsTable;
  reservation_requests: ReservationRequestsTable;
}
