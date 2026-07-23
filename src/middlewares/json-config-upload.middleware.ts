import multer from "multer";

export const jsonConfigUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname ?? "").toLowerCase();
    const isJsonMime =
      file.mimetype === "application/json" ||
      file.mimetype === "text/json" ||
      file.mimetype === "application/octet-stream" ||
      file.mimetype === "text/plain";
    const isJsonExt = name.endsWith(".json");
    cb(null, isJsonMime || isJsonExt);
  },
});
