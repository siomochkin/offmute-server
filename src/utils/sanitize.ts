/**
 * Utility functions for sanitizing file and directory names
 */
import path from "path";

/**
 * Sanitizes a directory name by replacing spaces with underscores and removing special characters
 * @param name The directory name to sanitize
 * @returns A sanitized directory name safe for filesystem operations
 */
export function sanitizeDirectoryName(name: string): string {
  // Replace spaces with underscores
  let sanitized = name.replace(/\s+/g, "_");

  // Remove special characters that could cause issues with directory names
  sanitized = sanitized.replace(/[^\w.-]/g, "_");

  // Ensure name doesn't start with a dot (unless it's specifically .offmute)
  if (sanitized.startsWith(".") && !sanitized.startsWith(".offmute")) {
    sanitized = "_" + sanitized.substring(1);
  }

  return sanitized;
}

/**
 * Sanitizes a file name by replacing spaces with underscores and removing special characters
 * @param name The file name to sanitize
 * @returns A sanitized file name safe for filesystem operations
 */
export function sanitizeFileName(name: string): string {
  // Replace spaces with underscores
  let sanitized = name.replace(/\s+/g, "_");

  // Remove special characters that could cause issues with filenames
  sanitized = sanitized.replace(/[^\w.-]/g, "_");

  return sanitized;
}

/**
 * Sanitizes a full path by sanitizing each component individually
 * @param filePath The full path to sanitize
 * @returns A sanitized path safe for filesystem operations
 */
export function sanitizePath(filePath: string): string {
  const parsedPath = path.parse(filePath);

  // Sanitize directory parts
  const dirParts = parsedPath.dir.split(path.sep);
  const sanitizedDirParts = dirParts.map((part) =>
    // Skip sanitizing empty parts or drive letters (Windows)
    part === "" || part.endsWith(":") ? part : sanitizeDirectoryName(part)
  );

  // Build sanitized path
  return path.join(
    sanitizedDirParts.join(path.sep),
    sanitizeFileName(parsedPath.name) + parsedPath.ext
  );
}
