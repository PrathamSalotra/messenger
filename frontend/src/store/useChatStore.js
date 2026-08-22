import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

export const useChatStore = create((set, get) => ({
  messages: [],
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,

  getUsers: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/users");
      set({ users: res.data });
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isUsersLoading: false });
    }
  },

  getMessages: async (userId) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`);
      set({ messages: res.data });
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isMessagesLoading: false });
    }
  },
  sendMessage: async (messageData) => {
    const { selectedUser, messages } = get();
    try {
      const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, messageData);
      // Check if message already exists (in case it was received via socket)
      const messageExists = messages.some(msg => msg._id === res.data._id);
      if (!messageExists) {
        // Add message and sort by createdAt to maintain chronological order
        const updatedMessages = [...messages, res.data].sort((a, b) => {
          const dateA = new Date(a.createdAt);
          const dateB = new Date(b.createdAt);
          return dateA - dateB;
        });
        set({ messages: updatedMessages });
      }
    } catch (error) {
      toast.error(error.response.data.message);
    }
  },

  subscribeToMessages: () => {
    const { selectedUser } = get();
    if (!selectedUser) return;

    // First, unsubscribe from any existing listeners to avoid duplicates
    get().unsubscribeFromMessages();

    const socket = useAuthStore.getState().socket;
    if (!socket) {
      console.warn("Socket is not initialized. Real-time messages may not work.");
      // Try to connect socket if authUser exists
      const authUser = useAuthStore.getState().authUser;
      if (authUser) {
        useAuthStore.getState().connectSocket();
        // Wait a bit and retry (socket connection is async)
        setTimeout(() => {
          if (useAuthStore.getState().socket?.connected) {
            get().subscribeToMessages();
          }
        }, 1000);
      }
      return;
    }

    if (!socket.connected) {
      console.warn("Socket is not connected. Waiting for connection...");
      // Listen for connection and then subscribe
      const onConnect = () => {
        socket.off("connect", onConnect);
        get().subscribeToMessages();
      };
      socket.on("connect", onConnect);
      return;
    }

    const handleNewMessage = (newMessage) => {
      const currentSelectedUser = get().selectedUser;
      if (!currentSelectedUser) return;

      const authUser = useAuthStore.getState().authUser;
      if (!authUser) return;

      // Check if this message is part of the current conversation
      // Message should be between current user and selected user
      const isMessageInCurrentConversation = 
        (newMessage.senderId === currentSelectedUser._id && newMessage.receiverId === authUser._id) ||
        (newMessage.senderId === authUser._id && newMessage.receiverId === currentSelectedUser._id);

      if (isMessageInCurrentConversation) {
        // Check if message already exists to avoid duplicates
        const existingMessages = get().messages;
        const messageExists = existingMessages.some(msg => msg._id === newMessage._id);
        
        if (!messageExists) {
          // Insert message in correct chronological order
          const updatedMessages = [...existingMessages, newMessage].sort((a, b) => {
            const dateA = new Date(a.createdAt);
            const dateB = new Date(b.createdAt);
            return dateA - dateB;
          });
          set({
            messages: updatedMessages,
          });
        }
      }
    };

    socket.on("newMessage", handleNewMessage);
  },

  unsubscribeFromMessages: () => {
    const socket = useAuthStore.getState().socket;
    if (socket && socket.connected) {
      socket.off("newMessage");
    }
  },

  setSelectedUser: (selectedUser) => set({ selectedUser }),
}));