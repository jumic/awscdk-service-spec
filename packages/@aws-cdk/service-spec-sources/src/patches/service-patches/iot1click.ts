import { Reason, addDefinitions, forResource, registerServicePatch, replaceDefinitionProperty } from './core';

/**
 * We enhance the types for IoT project
 */
registerServicePatch(
  forResource('AWS::IoT1Click::Project', (lens) => {
    const reason = Reason.other(
      'Set type of AWS::IoT1Click::Project.PlacementTemplate.DeviceTemplates to Map<String, AWS::IoT1Click::Project.DeviceTemplate>',
    );

    replaceDefinitionProperty(
      'PlacementTemplate',
      'DeviceTemplates',
      {
        type: 'object',
        $ref: '#/definitions/DeviceTemplate',
      },
      reason,
    )(lens);

    addDefinitions(
      {
        DeviceTemplate: {
          type: 'object',
          additionalProperties: false,
          DeviceType: {
            type: 'string',
          },
          CallbackOverrides: {
            type: 'object',
          },
        },
      },
      reason,
    )(lens);
  }),
);
