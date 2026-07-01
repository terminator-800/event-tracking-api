import multer from "multer";

const XLSX_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

export const xlsxUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isXlsxMime = XLSX_MIME_TYPES.includes(file.mimetype);
    const isXlsxExt = file.originalname.toLowerCase().endsWith(".xlsx");
    cb(null, isXlsxMime || isXlsxExt);
  },
});
