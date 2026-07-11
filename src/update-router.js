function getUpdateType(update) {
  if (update?.edited_message) return 'edited_message';
  if (update?.callback_query) return 'callback_query';
  if (update?.message) return 'message';
  return 'unsupported';
}

export function createUpdateHandler({ conversation, supergroupId }) {
  return async function handleUpdate(update) {
    const editedMessage = update?.edited_message;
    if (editedMessage) {
      if (editedMessage.chat?.type === 'private') {
        return conversation.handleEditedPrivateMessage(editedMessage);
      }
      if (String(editedMessage.chat?.id) === String(supergroupId)) {
        return conversation.handleEditedAdminMessage(editedMessage);
      }
      return { status: 'unsupported' };
    }

    const message = update?.message;
    if (message?.chat?.type === 'private') {
      return conversation.handlePrivateMessage(message);
    }
    if (message && String(message.chat?.id) === String(supergroupId)) {
      return conversation.handleAdminMessage(message);
    }
    return { status: 'unsupported' };
  };
}

export async function routeUpdate(update, {
  storage,
  handleUpdate,
  now = Date.now,
}) {
  const updateId = update?.update_id;
  if (updateId === undefined || updateId === null) {
    return new Response('Bad Request', { status: 400 });
  }

  const claim = await storage.claimUpdate(updateId, getUpdateType(update), now());
  if (claim === 'duplicate') return new Response('OK');

  try {
    const response = await handleUpdate(update);
    if (response instanceof Response && response.status >= 500) {
      await storage.markUpdateRetryable(updateId, `http_${response.status}`);
      return response;
    }

    await storage.completeUpdate(updateId, now());
    return response instanceof Response ? response : new Response('OK');
  } catch (error) {
    await storage.markUpdateRetryable(updateId, error?.category || 'temporary');
    return new Response('Internal Server Error', { status: 500 });
  }
}
