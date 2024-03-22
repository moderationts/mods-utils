import { Message, PermissionFlagsBits } from 'discord.js';
import { confirmGuild, unresolvedGuilds } from './chatInputCommand';
import { readConfig, throwError } from '../lib/util/functions';
import { safeCommands } from '../lib/util/constants';
import client from '../client';
import customMessageCommand from './customMessageCommand';
import commandLog from './commandLog';

export default async function (message: Message) {
  if (message.author.bot || !message.content || !message.inGuild()) return;

  const guild = await confirmGuild(message.guildId);
  const config = await readConfig(message.guildId).catch(() => {});
  if (!config || !config.commands.prefix || !config.commands.enabled) return;

  let prefix = config.commands.prefix;

  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).split(' ');
  let commandName = args[0];
  args.shift();

  const command =
    client.commands.message.get(commandName) || client.commands.message.get(client.aliases.get(commandName) as string);

  if (!command) {
    try {
      await customMessageCommand(message, args, commandName, config);
    } catch (e) {
      if (typeof e !== 'string') {
        console.error(e);
        return;
      }

      return throwError(message, e);
    }

    return;
  }

  commandName = command.name;

  if (command.clientPermissions) {
    if (!message.guild!.members.me!.permissions.has(command.clientPermissions))
      return message.reply(
        `**Configuration error.**\n> The command could not be executed as I don't have the required permissions for it.\n> For me to execute this command you need to give me the following permission(s): \`${command.clientPermissions
          .toArray()
          .join('`, `')
          .replaceAll(/[a-z][A-Z]/g, m => `${m[0]} ${m[1]}`)}\`.`
      );
  }

  if (command.userPermissions) {
    if (!message.member!.permissions.has(command.userPermissions)) {
      const override = config.commands.overrides?.find(override => override.name === commandName);
      if (!message.member!.roles.cache.some(role => override?.roles.includes(role.id))) {
        return message.delete().catch(() => {});
      }
    }
  }

  if (command.commandChannel) {
    if (
      !config.commands.channels?.includes(message.channelId) &&
      !message.member!.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      if (config.commands.channels?.length! === 0) return message.delete().catch(() => {});
      return message
        .reply(
          `Whoops! You can only use commands in the following channel${
            config.commands.channels?.length! > 1 ? 's' : ''
          }: ${config.commands.channels?.map(channel => `<#${channel}>`).join(', ')}.`
        )
        .then(msg => {
          setTimeout(() => {
            msg.delete().catch(() => {});
            message.delete().catch(() => {});
          }, 5000);
        });
    }
  }

  if (command.guildResolve) {
    if (unresolvedGuilds.has(`${message.guildId!} ${commandName}`))
      return throwError(
        message,
        'Another process of this command is currently running. Please wait for it to finish before running this command.'
      );

    unresolvedGuilds.add(`${message.guildId!} ${commandName}`);
  }

  try {
    await command.run(message, args, config);
    if (command.guildResolve) unresolvedGuilds.delete(`${message.guildId!} ${commandName}`);
    if (!safeCommands.includes(command.name)) commandLog(message, command.name);
  } catch (e) {
    if (command.guildResolve) unresolvedGuilds.delete(`${message.guildId!} ${commandName}`);

    if (typeof e !== 'string') {
      console.error(e);
      return;
    }

    return throwError(message, e);
  }
}