"use client";

import { useEffect, useState, useRef } from 'react';
import { auth, db } from '../../../lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, getDocs, doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  photoURL: string;
  bio?: string;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  receiverId: string;
  createdAt: any;
  senderName: string;
  senderPhotoURL: string;
}

interface Conversation {
  id: string;
  participants: string[];
  lastMessage: Message;
  otherUser: {
    id: string;
    username: string;
    photoURL: string;
  };
}

export default function Messages() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.push('/');
      } else {
        setCurrentUser(user);
        // Fetch user profile data
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as User);
        }
      }
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    document.title = "Messaging | Yapp";
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const fetchConversations = async () => {
      try {
        // Fetch conversations
        const conversationsRef = collection(db, 'conversations');
        const q = query(
          conversationsRef,
          where('participants', 'array-contains', currentUser.uid)
        );

        const unsubscribe = onSnapshot(q, async (snapshot) => {
          try {
            const conversationsData: Conversation[] = [];
            
            for (const docSnapshot of snapshot.docs) {
              const data = docSnapshot.data();
              const otherUserId = data.participants.find((id: string) => id !== currentUser.uid);
              
              // Fetch other user's data
              const userDocRef = doc(db, 'users', otherUserId);
              const userDoc = await getDoc(userDocRef);
              const otherUserData = userDoc.data() as User | undefined;

              if (otherUserData) {
                conversationsData.push({
                  id: docSnapshot.id,
                  participants: data.participants,
                  lastMessage: data.lastMessage || {
                    id: 'initial',
                    text: 'Conversation started',
                    senderId: currentUser.uid,
                    receiverId: otherUserId,
                    createdAt: data.createdAt || serverTimestamp(),
                    senderName: userProfile?.username || 'Unknown',
                    senderPhotoURL: userProfile?.photoURL || '/default-avatar.svg'
                  },
                  otherUser: {
                    id: otherUserId,
                    username: otherUserData.username || 'Unknown',
                    photoURL: otherUserData.photoURL || '/default-avatar.svg'
                  }
                });
              }
            }

            setConversations(conversationsData);
            setIsLoading(false);
          } catch (error) {
            console.error('Error fetching conversations:', error);
            setError('Unable to load conversations. Please try again.');
            setIsLoading(false);
          }
        }, (error) => {
          console.error('Error in conversations snapshot:', error);
          setError('Unable to load conversations. Please try again.');
          setIsLoading(false);
        });

        return unsubscribe;
      } catch (error) {
        console.error('Error setting up conversations listener:', error);
        setError('Unable to load conversations. Please try again.');
        setIsLoading(false);
        return () => {};
      }
    };

    const unsubscribe = fetchConversations();
    return () => {
      unsubscribe.then(unsub => unsub());
    };
  }, [currentUser?.uid, userProfile?.username, userProfile?.photoURL]);

  useEffect(() => {
    if (!selectedConversation?.id || !currentUser?.uid) {
      console.log('No conversation selected or user not logged in');
      return;
    }
    console.log('Fetching messages for conversation:', selectedConversation.id, 'as user:', currentUser.uid);
    setError(null); // Clear previous errors
    setIsLoading(true); // Start loading now that we have confirmed IDs

    // Helper to merge and sort messages
    const mergeAndSortMessages = (msgs1: Message[], msgs2: Message[]): Message[] => {
      const all = [...msgs1, ...msgs2];
      const unique = Array.from(new Map(all.map(m => [m.id, m])).values());
      return unique.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return a.createdAt.seconds - b.createdAt.seconds;
      });
    };

    const messagesRef = collection(db, 'messages');
    // We've confirmed selectedConversation.id and currentUser.uid are defined strings here
    const q1 = query(
      messagesRef,
      where('conversationId', '==', selectedConversation.id),
      where('senderId', '==', currentUser.uid),
      orderBy('createdAt', 'asc')
    );
    const q2 = query(
      messagesRef,
      where('conversationId', '==', selectedConversation.id),
      where('receiverId', '==', currentUser.uid),
      orderBy('createdAt', 'asc')
    );

    let unsub1: (() => void) | undefined, unsub2: (() => void) | undefined;
    let msgs1: Message[] = [], msgs2: Message[] = [];

    unsub1 = onSnapshot(q1, (snapshot) => {
      console.log('Sender query snapshot:', snapshot.docs.map(doc => doc.data()));
      msgs1 = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(mergeAndSortMessages(msgs1, msgs2));
      setIsLoading(false); // Always set loading to false after first snapshot
    }, (error) => {
      console.error('Error fetching messages (sender query):', error);
      setError('Unable to load messages. Please check permissions or network.');
      setIsLoading(false);
    });

    unsub2 = onSnapshot(q2, (snapshot) => {
      console.log('Receiver query snapshot:', snapshot.docs.map(doc => doc.data()));
      msgs2 = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(mergeAndSortMessages(msgs1, msgs2));
      setIsLoading(false); // Always set loading to false after first snapshot
    }, (error) => {
      console.error('Error fetching messages (receiver query):', error);
      setError('Unable to load messages. Please check permissions or network.');
      setIsLoading(false);
    });

    return () => {
      unsub1 && unsub1();
      unsub2 && unsub2();
    };
  }, [selectedConversation?.id, currentUser?.uid]); // Dependencies are correct

  const fetchUsers = async () => {
    if (!currentUser) return;
    
    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('username', '>=', searchTerm.toLowerCase()),
      where('username', '<=', searchTerm.toLowerCase() + '\uf8ff')
    );
    const querySnapshot = await getDocs(q);
    const usersData = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as User[];
    setUsers(usersData);
    setFilteredUsers(usersData);
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.trim()) {
        fetchUsers();
      } else {
        // If search term is empty, show all users
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('id', '!=', currentUser?.uid));
        getDocs(q).then(querySnapshot => {
          const usersData = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as User[];
          setUsers(usersData);
          setFilteredUsers(usersData);
        });
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, currentUser]);

  const startNewConversation = async (selectedUser: User) => {
    if (!currentUser || !userProfile) return;

    try {
      // Check if conversation already exists
      const conversationsRef = collection(db, 'conversations');
      const q = query(
        conversationsRef,
        where('participants', 'array-contains', currentUser.uid)
      );
      const querySnapshot = await getDocs(q);
      
      const existingConversation = querySnapshot.docs.find(doc => {
        const data = doc.data();
        return data.participants.includes(selectedUser.id);
      });

      if (existingConversation) {
        // If conversation exists, select it
        const conversationData = existingConversation.data();
        const conversation: Conversation = {
          id: existingConversation.id,
          participants: conversationData.participants,
          lastMessage: conversationData.lastMessage || {
            id: 'initial',
            text: 'Conversation started',
            senderId: currentUser.uid,
            receiverId: selectedUser.id,
            createdAt: serverTimestamp(),
            senderName: userProfile.username,
            senderPhotoURL: userProfile.photoURL || '/default-avatar.svg'
          },
          otherUser: {
            id: selectedUser.id,
            username: selectedUser.username,
            photoURL: selectedUser.photoURL || '/default-avatar.svg'
          }
        };
        setSelectedConversation(conversation);
        setShowNewConversationModal(false);
        return;
      }

      // Create new conversation
      const newConversation = await addDoc(conversationsRef, {
        participants: [currentUser.uid, selectedUser.id],
        createdAt: serverTimestamp(),
        lastMessage: {
          id: 'initial',
          text: 'Conversation started',
          senderId: currentUser.uid,
          receiverId: selectedUser.id,
          createdAt: serverTimestamp(),
          senderName: userProfile.username,
          senderPhotoURL: userProfile.photoURL || '/default-avatar.svg'
        }
      });

      // Create the conversation object
      const conversation: Conversation = {
        id: newConversation.id,
        participants: [currentUser.uid, selectedUser.id],
        lastMessage: {
          id: 'initial',
          text: 'Conversation started',
          senderId: currentUser.uid,
          receiverId: selectedUser.id,
          createdAt: serverTimestamp(),
          senderName: userProfile.username,
          senderPhotoURL: userProfile.photoURL || '/default-avatar.svg'
        },
        otherUser: {
          id: selectedUser.id,
          username: selectedUser.username,
          photoURL: selectedUser.photoURL || '/default-avatar.svg'
        }
      };

      setSelectedConversation(conversation);
      setShowNewConversationModal(false);
    } catch (error) {
      console.error('Error starting new conversation:', error);
      setError('Unable to start conversation. Please try again.');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversation || !currentUser) return;

    try {
      // First, create the message
      const messagesRef = collection(db, 'messages');
      const messageData = {
        text: newMessage,
        senderId: currentUser.uid,
        receiverId: selectedConversation.otherUser.id,
        conversationId: selectedConversation.id,
        createdAt: serverTimestamp(),
        senderName: userProfile?.username || 'Unknown',
        senderPhotoURL: userProfile?.photoURL || '/default-avatar.svg',
        read: false
      };

      const messageRef = await addDoc(messagesRef, messageData);

      // Then update the conversation's last message
      const conversationRef = doc(db, 'conversations', selectedConversation.id);
      await updateDoc(conversationRef, {
        lastMessage: {
          ...messageData,
          id: messageRef.id
        }
      });

      setNewMessage('');
    } catch (error: any) {
      console.error('Error sending message:', error);
      setError('Unable to send message. Please try again.');
    }
  };

  const handleDeleteConversation = async () => {
    if (!conversationToDelete || !currentUser) return;

    try {
      // First verify the conversation exists and user has access
      const conversationRef = doc(db, 'conversations', conversationToDelete.id);
      const conversationDoc = await getDoc(conversationRef);
      
      if (!conversationDoc.exists()) {
        throw new Error('Conversation not found');
      }

      const conversationData = conversationDoc.data();
      if (!conversationData.participants.includes(currentUser.uid)) {
        throw new Error('You do not have permission to delete this conversation');
      }

      // Delete all messages in the conversation where user is either sender or receiver
      const messagesRef = collection(db, 'messages');
      const q = query(
        messagesRef,
        where('conversationId', '==', conversationToDelete.id),
        where('senderId', '==', currentUser.uid)
      );
      const q2 = query(
        messagesRef,
        where('conversationId', '==', conversationToDelete.id),
        where('receiverId', '==', currentUser.uid)
      );

      const [sentMessages, receivedMessages] = await Promise.all([
        getDocs(q),
        getDocs(q2)
      ]);
      
      // Delete messages in batches to avoid overwhelming Firestore
      const batchSize = 500;
      const allMessages = [...sentMessages.docs, ...receivedMessages.docs];
      
      for (let i = 0; i < allMessages.length; i += batchSize) {
        const batch = allMessages.slice(i, i + batchSize);
        const deletePromises = batch.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
      }

      // Finally delete the conversation document
      await deleteDoc(conversationRef);

      // Update UI
      setConversations(prev => prev.filter(conv => conv.id !== conversationToDelete.id));
      if (selectedConversation?.id === conversationToDelete.id) {
        setSelectedConversation(null);
        setMessages([]);
      }
      setShowDeleteModal(false);
      setConversationToDelete(null);
      setError(null);
    } catch (error: any) {
      console.error('Error deleting conversation:', error);
      setError(error.message || 'Unable to delete conversation. Please try again.');
      setShowDeleteModal(false);
      setConversationToDelete(null);
    }
  };

  const formatMessageTime = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  };

  if (!currentUser) {
    return null;
  }

  if (isLoading && !selectedConversation) {
    return (
      <div className="min-h-screen bg-[#f6ebff] p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#6c5ce7]"></div>
          </div>
        </div>
      </div>
    );
  }

  console.log('Rendering messages:', messages);

  return (
    <div className="min-h-screen bg-[#f6ebff]">
      {/* Navigation */}
      <nav className="bg-[#6c5ce7] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link 
                href="/dashboard" 
                className="text-xl font-bold text-white hover:text-[#f6ebff] transition-colors cursor-pointer"
              >
                Yapp
              </Link>
              <div className="hidden md:flex space-x-4">
                <Link href="/dashboard" className="text-white hover:bg-[#ab9dd3] px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Home
                </Link>
                <Link href="/dashboard/search" className="text-white hover:bg-[#ab9dd3] px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Search
                </Link>
                <Link href="/dashboard/messages" className="text-white hover:bg-[#ab9dd3] px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Messages
                </Link>
                <Link href="/dashboard/affirmations" className="text-white hover:bg-[#ab9dd3] px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Weekly Discussion
                </Link>
                <Link href="/dashboard/profile" className="text-white hover:bg-[#ab9dd3] px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Profile
                </Link>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-white text-sm">Welcome, {userProfile?.firstName || 'User'}</span>
              <button
                onClick={() => auth.signOut()}
                className="px-4 py-2 bg-[#68baa5] text-white rounded-md hover:bg-[#5aa594] transition-colors font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <div className="max-w-7xl mx-auto py-6 px-4">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="flex h-[calc(100vh-12rem)]">
            {/* Conversations list */}
            <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-xl font-bold text-[#6c5ce7]">Messages</h2>
                <button
                  onClick={() => {
                    setShowNewConversationModal(true);
                    fetchUsers();
                  }}
                  className="px-3 py-1 bg-[#6c5ce7] text-white rounded-md hover:bg-[#5a4dc7] transition-colors text-sm"
                >
                  New Conversation
                </button>
              </div>
              <div className="divide-y divide-gray-200">
                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 ${
                      selectedConversation?.id === conversation.id ? 'bg-[#f6ebff]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div 
                        className="flex items-center space-x-3 flex-1"
                        onClick={() => setSelectedConversation(conversation)}
                      >
                        <div className="relative w-10 h-10">
                          <Image
                            src={conversation.otherUser.photoURL}
                            alt={`${conversation.otherUser.username}'s profile picture`}
                            fill
                            className="rounded-full object-cover"
                          />
                        </div>
                        <div>
                          <h3 className="font-semibold text-[#6c5ce7]">
                            {conversation.otherUser.username}
                          </h3>
                          <p className="text-sm text-gray-500 truncate">
                            {conversation.lastMessage?.text || 'No messages yet'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConversationToDelete(conversation);
                          setShowDeleteModal(true);
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 flex flex-col">
              {selectedConversation ? (
                <>
                  {/* Chat header */}
                  <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center space-x-3">
                      <div className="relative w-10 h-10">
                        <Image
                          src={selectedConversation.otherUser.photoURL}
                          alt={`${selectedConversation.otherUser.username}'s profile picture`}
                          fill
                          className="rounded-full object-cover"
                        />
                      </div>
                      <h3 className="font-semibold text-[#6c5ce7]">
                        {selectedConversation.otherUser.username}
                      </h3>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {error ? (
                      <div className="text-center text-red-500 p-4">{error}</div>
                    ) : isLoading ? (
                      <div className="flex justify-center items-center h-32">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6c5ce7]"></div>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center text-gray-500 p-4">No messages yet. Start the conversation!</div>
                    ) : (
                      messages.map((message: Message) => {
                        const isCurrentUser = message.senderId === currentUser.uid;
                        return (
                          <div
                            key={message.id}
                            className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[70%] rounded-lg p-3 mb-2 shadow-md ${
                                isCurrentUser
                                  ? 'bg-[#6c5ce7] text-white rounded-br-none'
                                  : 'bg-gray-200 text-gray-800 rounded-bl-none'
                              }`}
                            >
                              <div className="flex items-center mb-1">
                                <span className="font-semibold text-xs mr-2">
                                  {isCurrentUser ? 'You' : (message.senderName || 'Other')}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {formatMessageTime(message.createdAt)}
                                </span>
                              </div>
                              <div className="break-words whitespace-pre-line">{message.text}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message input */}
                  <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200">
                    <div className="flex space-x-4">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#6c5ce7] text-white rounded-lg hover:bg-[#5a4dc7] transition-colors"
                      >
                        Send
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-500">Select a conversation to start chatting</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Conversation Modal */}
      {showNewConversationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-[#6c5ce7]">Start New Conversation</h2>
              <button
                onClick={() => setShowNewConversationModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
              />
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredUsers.length > 0 ? (
                filteredUsers.map(user => (
                  <div
                    key={user.id}
                    className="flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                    onClick={() => startNewConversation(user)}
                  >
                    <div className="relative w-10 h-10">
                      <Image
                        src={user.photoURL || '/default-avatar.svg'}
                        alt={`${user.firstName} ${user.lastName}'s profile picture`}
                        fill
                        className="rounded-full object-cover"
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#6c5ce7]">{user.username}</h3>
                      <p className="text-sm text-gray-500">
                        {user.firstName} {user.lastName}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">
                  No users found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && conversationToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-[#6c5ce7]">Delete Conversation</h2>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setConversationToDelete(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <p className="mb-4">
              Are you sure you want to delete this conversation with {conversationToDelete.otherUser.username}? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setConversationToDelete(null);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConversation}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom banner */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#6c5ce7] text-white p-4 text-center shadow-lg">
        <p>Welcome to Yapp! Share your positive affirmations and creative stories!</p>
      </div>
    </div>
  );
} 