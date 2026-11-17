// What one upload request can carry.
//
// Storage accepts files up to 10 MB (MAX_ATTACHMENT_BYTES in parse.ts), but
// a function request body on Vercel ends at 4.5 MB: a larger file is refused
// by the platform before any code runs, with a 413 that carries no JSON.
// The page promised "10 MB" and then failed between 4.5 and 10 MB with a
// message that named the wrong limit. It now checks before sending and
// names the limit that really applies (4 MB leaves room for the multipart
// envelope).

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";
