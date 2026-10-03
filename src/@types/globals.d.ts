// export interface VivinoMessage {
//   query: 'getRating';
//   productName: string;
// }
// export interface VivinoResponse {
//   found: boolean;
//   name: string | null;
//   rating: number;
//   votes: number;
//   link: string | null;
// }

declare module '*.yml?raw' {
  const content: string
  export default content
}
