import { parser } from '@rocket.chat/message-parser';
import React, { ReactElement, useMemo } from 'react';

import { IMessage } from '../../../../../definition/IMessage';
import MessageBodyRender from '../../../../components/Message/MessageBodyRender';
import { useTranslation } from '../../../../contexts/TranslationContext';
import { useMessageActions } from '../../contexts/MessageContext';

const EncryptedMessageRender = ({ message }: { message: IMessage }): ReactElement => {
	const tokens = useMemo(() => parser(message.msg), [message.msg]);
	const t = useTranslation();

	const {
		actions: { openUserCard, openRoom },
	} = useMessageActions();

	if (message.e2e === 'pending') {
		return <>{t('E2E_message_encrypted_placeholder')}</>;
	}

	return (
		<MessageBodyRender
			onUserMentionClick={openUserCard}
			onChannelMentionClick={openRoom}
			mentions={message?.mentions || []}
			channels={message?.channels || []}
			tokens={tokens}
		/>
	);
};

export default EncryptedMessageRender;
