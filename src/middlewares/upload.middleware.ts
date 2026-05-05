import multer from "multer";

const memoryStorage = multer.memoryStorage();

export const csvUploadMiddleware = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    const isCsvMime =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "application/csv";
    const isCsvExt = file.originalname.toLowerCase().endsWith(".csv");
    cb(null, isCsvMime || isCsvExt);
  },
});
