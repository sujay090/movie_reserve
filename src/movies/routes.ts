import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";
import { deleteKey, getJson, setJson } from "../cache/redis.js";

interface MovieBody {
  title: string;
  description: string;
  posterUrl?: string;
  durationMinutes: number;
  releaseDate?: string;
  ageRating?: string;
  genreIds?: string[];
}

interface MovieParams {
  movieId: string;
}

const errorResponse = (
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) => reply.code(statusCode).send({ error: { code, message } });

const requireAdmin = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> => {
  if (!request.userId) {
    errorResponse(reply, 401, "UNAUTHENTICATED", "A valid session is required");
    return false;
  }
  const user = await db
    .selectFrom("users")
    .select("role")
    .where("id", "=", request.userId)
    .where("status", "=", "ACTIVE")
    .executeTakeFirst();
  if (!user || user.role !== "ADMIN") {
    errorResponse(reply, 403, "FORBIDDEN", "Administrator access is required");
    return false;
  }
  return true;
};

async function movieWithGenres(movieId: string) {
  const movie = await db
    .selectFrom("movies")
    .selectAll()
    .where("id", "=", movieId)
    .where("status", "!=", "ARCHIVED")
    .executeTakeFirst();
  if (!movie) return null;
  const genres = await db
    .selectFrom("movie_genres")
    .innerJoin("genres", "genres.id", "movie_genres.genre_id")
    .select(["genres.id", "genres.name"])
    .where("movie_genres.movie_id", "=", movieId)
    .orderBy("genres.name")
    .execute();
  return { ...movie, genres };
}

const movieSchema = {
  type: "object",
  required: [
    "id",
    "title",
    "description",
    "durationMinutes",
    "status",
    "genres",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    posterUrl: { type: ["string", "null"] },
    durationMinutes: { type: "integer" },
    releaseDate: { type: ["string", "null"] },
    ageRating: { type: ["string", "null"] },
    status: { type: "string" },
    genres: { type: "array", items: { type: "object" } },
  },
} as const;

function serializeMovie(
  movie: NonNullable<Awaited<ReturnType<typeof movieWithGenres>>>,
) {
  return {
    id: movie.id,
    title: movie.title,
    description: movie.description,
    posterUrl: movie.poster_url,
    durationMinutes: movie.duration_minutes,
    releaseDate: movie.release_date,
    ageRating: movie.age_rating,
    status: movie.status,
    genres: movie.genres,
  };
}

export async function registerMovieRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      page?: number;
      limit?: number;
      search?: string;
      genreId?: string;
    };
  }>(
    "/api/v1/movies",
    {
      schema: {
        tags: ["Movies"],
        summary: "List active movies",
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            search: { type: "string", maxLength: 100 },
            genreId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const page = request.query.page ?? 1;
      const limit = request.query.limit ?? 20;
      const offset = (page - 1) * limit;
      const cacheKey = `movies:list:${page}:${limit}:${request.query.search ?? ""}:${request.query.genreId ?? ""}`;
      try {
        const cached = await getJson<unknown>(cacheKey);
        if (cached) return { data: cached, requestId: request.id };
      } catch (error) {
        request.log.warn({ error }, "Movie list cache read failed");
      }

      let query = db
        .selectFrom("movies")
        .selectAll()
        .where("status", "=", "ACTIVE")
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset);
      if (request.query.search)
        query = query.where("title", "ilike", `%${request.query.search}%`);
      if (request.query.genreId) {
        query = query.where(
          "id",
          "in",
          db
            .selectFrom("movie_genres")
            .select("movie_id")
            .where("genre_id", "=", request.query.genreId),
        );
      }
      const movies = await query.execute();
      const data = {
        items: movies.map((movie) => serializeMovie({ ...movie, genres: [] })),
        page,
        limit,
      };
      try {
        await setJson(cacheKey, data, 60);
      } catch (error) {
        request.log.warn({ error }, "Movie list cache write failed");
      }
      return { data, requestId: request.id };
    },
  );

  app.get<{ Params: MovieParams }>(
    "/api/v1/movies/:movieId",
    {
      schema: {
        tags: ["Movies"],
        summary: "Get movie details",
        params: {
          type: "object",
          required: ["movieId"],
          properties: { movieId: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: { data: movieSchema, requestId: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const cacheKey = `movies:${request.params.movieId}`;
      try {
        const cached =
          await getJson<ReturnType<typeof serializeMovie>>(cacheKey);
        if (cached) return { data: cached, requestId: request.id };
      } catch (error) {
        request.log.warn({ error }, "Movie cache read failed");
      }
      const movie = await movieWithGenres(request.params.movieId);
      if (!movie)
        return errorResponse(
          reply,
          404,
          "MOVIE_NOT_FOUND",
          "Movie was not found",
        );
      const data = serializeMovie(movie);
      try {
        await setJson(cacheKey, data, 60);
      } catch (error) {
        request.log.warn({ error }, "Movie cache write failed");
      }
      return { data, requestId: request.id };
    },
  );

  app.post<{ Body: MovieBody }>(
    "/api/v1/admin/movies",
    {
      schema: { tags: ["Admin"], summary: "Create a movie" },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const body = request.body;
      const movie = await db
        .insertInto("movies")
        .values({
          title: body.title.trim(),
          description: body.description.trim(),
          poster_url: body.posterUrl ?? null,
          duration_minutes: body.durationMinutes,
          release_date: body.releaseDate ?? null,
          age_rating: body.ageRating ?? null,
          status: "ACTIVE",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (body.genreIds?.length) {
        await db
          .insertInto("movie_genres")
          .values(
            body.genreIds.map((genre_id) => ({ movie_id: movie.id, genre_id })),
          )
          .execute();
      }
      return reply
        .code(201)
        .send({ data: await movieWithGenres(movie.id), requestId: request.id });
    },
  );

  app.post<{ Body: { name: string } }>(
    "/api/v1/admin/genres",
    {
      schema: {
        tags: ["Admin"],
        summary: "Create a genre",
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const genre = await db
        .insertInto("genres")
        .values({ name: request.body.name.trim() })
        .returningAll()
        .executeTakeFirstOrThrow();
      await deleteKey("genres:list");
      return reply.code(201).send({ data: genre, requestId: request.id });
    },
  );

  app.get(
    "/api/v1/genres",
    { schema: { tags: ["Movies"], summary: "List genres" } },
    async (request) => {
      const genres = await db
        .selectFrom("genres")
        .selectAll()
        .orderBy("name")
        .execute();
      return { data: genres, requestId: request.id };
    },
  );
}
