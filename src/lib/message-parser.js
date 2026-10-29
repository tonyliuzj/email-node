import { simpleParser } from 'mailparser'

// By default the parser swaps every cid: picture reference in a message for the picture's own bytes (a data:
// address). The sanitiser has to remove those, because a data: address can carry anything, so the picture was
// lost and the message showed a broken image. With this option the reference stays as cid:, and the inbox page
// fetches the picture through the same checked, size-limited download as an attachment and places it in.
export function parseMessage(source) {
  return simpleParser(source, { skipImageLinks: true })
}
